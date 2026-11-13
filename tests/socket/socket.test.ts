import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import type { Server } from "socket.io";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION, ME, OTHER } from "../helpers";

const THIRD = "ffffffffffffffffffffffff";
const STRANGER = "999999999999999999999999";
const GROUP = "abababababababababababab";

// conversation id -> member ids
const MEMBERS: Record<string, string[]> = {
  [CONVERSATION]: [ME, OTHER],
  [GROUP]: [ME, OTHER, THIRD],
};

const emailOf = (id: string) => `${id.slice(0, 4)}@example.com`;

// The session cookie value is the user id; getToken turns it into a token.
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(async ({ req }: any) => {
    const id = req.cookies["next-auth.session-token"];
    return id ? { email: `${id.slice(0, 4)}@example.com`, sub: id } : null;
  }),
}));

vi.mock("@/app/libs/prismadb", () => ({
  default: {
    conversation: {
      findFirst: vi.fn(async ({ where }: any) =>
        MEMBERS[where.id]?.includes(where.userIds.has) ? { id: where.id } : null
      ),
    },
  },
}));

import { initSocketServer } from "@/server/socket";
import { emitToConversation } from "@/app/libs/socket-server";
import { conversationRoom } from "@/app/libs/socket-rooms";

// ---- harness ----
const servers: { http: HttpServer; io: Server }[] = [];
const clients: ClientSocket[] = [];

const startServer = async () => {
  const http = createServer();
  const io = await initSocketServer(http);
  await new Promise<void>((resolve) => http.listen(0, resolve));
  servers.push({ http, io });
  return { io, url: `http://localhost:${(http.address() as AddressInfo).port}` };
};

const client = (url: string, userId?: string) => {
  const socket = connect(url, {
    transports: ["websocket"],
    reconnection: false,
    forceNew: true,
    extraHeaders: userId ? { cookie: `next-auth.session-token=${userId}` } : {},
  });
  clients.push(socket);
  return socket;
};

// connects and resolves with the first presence:list it receives
const connected = (url: string, userId: string) => {
  const socket = client(url, userId);
  return new Promise<{ socket: ClientSocket; online: string[] }>((resolve, reject) => {
    socket.once("presence:list", (online: string[]) => resolve({ socket, online }));
    socket.once("connect_error", reject);
  });
};

const next = <T = unknown>(socket: ClientSocket, event: string) =>
  new Promise<T>((resolve) => socket.once(event, resolve));

const joinCall = (socket: ClientSocket, roomId: string) =>
  new Promise<{ ok: boolean; isHost?: boolean }>((resolve) =>
    socket.emit("call:join", roomId, resolve)
  );

afterEach(async () => {
  clients.splice(0).forEach((socket) => socket.close());
  await Promise.all(
    servers.splice(0).map(
      ({ io }) => new Promise<void>((resolve) => io.close(() => resolve()))
    )
  );
  vi.unstubAllEnvs();
});

// ---- tests ----
describe("socket server", () => {
  it("rejects connections without a session", async () => {
    const { url } = await startServer();
    const error = await next<Error>(client(url), "connect_error");
    expect(error.message).toBe("Unauthorized");
  });

  it("tracks presence across users and tabs", async () => {
    const { url } = await startServer();
    const a = await connected(url, ME);
    expect(a.online).toEqual([emailOf(ME)]);

    const cameOnline = next<string>(a.socket, "presence:online");
    const b1 = await connected(url, OTHER);
    expect(await cameOnline).toBe(emailOf(OTHER));
    expect(b1.online.sort()).toEqual([emailOf(ME), emailOf(OTHER)].sort());

    // closing one of two tabs keeps the user online
    const b2 = await connected(url, OTHER);
    const offline = vi.fn();
    a.socket.on("presence:offline", offline);
    b1.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(offline).not.toHaveBeenCalled();

    // closing the last tab announces offline
    const wentOffline = next<string>(a.socket, "presence:offline");
    b2.socket.close();
    expect(await wentOffline).toBe(emailOf(OTHER));
  });

  it("only lets members into a conversation room", async () => {
    const { io, url } = await startServer();
    const member = (await connected(url, ME)).socket;
    const stranger = (await connected(url, STRANGER)).socket;

    member.emit("conversation:join", CONVERSATION);
    stranger.emit("conversation:join", CONVERSATION);
    await vi.waitFor(async () =>
      expect(await io.in(conversationRoom(CONVERSATION)).fetchSockets()).toHaveLength(1)
    );

    const strangerGot = vi.fn();
    stranger.on("messages:new", strangerGot);
    const memberGot = next(member, "messages:new");
    emitToConversation(CONVERSATION, "messages:new", { id: "m1" });

    expect(await memberGot).toEqual({ id: "m1" });
    expect(strangerGot).not.toHaveBeenCalled();
  });

  it("runs a call: host first, a second peer, nobody else", async () => {
    const { url } = await startServer();
    const host = (await connected(url, ME)).socket;
    const guest = (await connected(url, OTHER)).socket;
    const third = (await connected(url, THIRD)).socket;
    const stranger = (await connected(url, STRANGER)).socket;

    expect(await joinCall(stranger, GROUP)).toEqual({ ok: false });
    expect(await joinCall(host, GROUP)).toEqual({ ok: true, isHost: true });
    expect(await joinCall(guest, GROUP)).toEqual({ ok: true, isHost: false });
    expect(await joinCall(third, GROUP)).toEqual({ ok: false });

    // signalling is relayed to the other peer only
    const thirdGot = vi.fn();
    third.on("call:offer", thirdGot);
    const ready = next(host, "call:ready");
    guest.emit("call:ready", GROUP);
    await ready;
    const offer = next(guest, "call:offer");
    host.emit("call:offer", GROUP, { type: "offer", sdp: "x" });
    expect(await offer).toEqual({ type: "offer", sdp: "x" });
    expect(thirdGot).not.toHaveBeenCalled();

    // leaving ends the call for the other side
    const left = next(host, "call:peer-left");
    guest.emit("call:leave", GROUP);
    await left;
  });

  it("picks exactly one host when both peers join at the same time", async () => {
    const { url } = await startServer();
    const a = (await connected(url, ME)).socket;
    const b = (await connected(url, OTHER)).socket;

    const results = await Promise.all([joinCall(a, CONVERSATION), joinCall(b, CONVERSATION)]);

    expect(results.every((result) => result.ok)).toBe(true);
    expect(results.filter((result) => result.isHost)).toHaveLength(1);
  });
});

// Two app instances sharing one Redis: needs a real Redis, e.g.
//   docker run --rm -p 6390:6379 redis:7-alpine
//   TEST_REDIS_URL=redis://localhost:6390 npm test
describe.skipIf(!process.env.TEST_REDIS_URL)("socket server on two instances (Redis)", () => {
  const twoInstances = async () => {
    vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL!);
    return [await startServer(), await startServer()] as const;
  };

  it("delivers emits and presence across instances", async () => {
    const [one, two] = await twoInstances();
    const a = await connected(one.url, ME);

    const cameOnline = next<string>(a.socket, "presence:online");
    const b = await connected(two.url, OTHER);
    expect(await cameOnline).toBe(emailOf(OTHER));
    expect(b.online).toContain(emailOf(ME));

    b.socket.emit("conversation:join", CONVERSATION);
    await vi.waitFor(async () =>
      expect(await one.io.in(conversationRoom(CONVERSATION)).fetchSockets()).toHaveLength(1)
    );
    // emitted on instance one, received by a socket connected to instance two
    const got = next(b.socket, "messages:new");
    one.io.to(conversationRoom(CONVERSATION)).emit("messages:new", { id: "m2" });
    expect(await got).toEqual({ id: "m2" });

    const wentOffline = next<string>(a.socket, "presence:offline");
    b.socket.close();
    expect(await wentOffline).toBe(emailOf(OTHER));
  });

  it("runs a call whose peers are on different instances", async () => {
    const [one, two] = await twoInstances();
    const host = (await connected(one.url, ME)).socket;
    const guest = (await connected(two.url, OTHER)).socket;
    const third = (await connected(two.url, THIRD)).socket;

    expect(await joinCall(host, GROUP)).toEqual({ ok: true, isHost: true });
    expect(await joinCall(guest, GROUP)).toEqual({ ok: true, isHost: false });
    expect(await joinCall(third, GROUP)).toEqual({ ok: false });

    const offer = next(guest, "call:offer");
    host.emit("call:offer", GROUP, { type: "offer", sdp: "y" });
    expect(await offer).toEqual({ type: "offer", sdp: "y" });
  });
});
