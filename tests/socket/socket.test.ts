import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { createClient } from "redis";
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
const userOf = (id: string) => ({ id, email: emailOf(id) });

// call messages started within the ring time (what resendRingingCalls finds in the database)
const RECENT_CALLS: {
  conversationId: string;
  senderId: string;
  callType?: "audio" | "video";
}[] = [];

// conversation id -> its latest call message, the one server/call-log.ts moves along
type CallRow = {
  id: string;
  senderId: string;
  callStatus: string;
  callAnsweredAt?: Date;
  callEndedAt?: Date;
};
const CALLS: Record<string, CallRow> = {};
const callById = (id: string) => Object.values(CALLS).find((call) => call.id === id);

// user id -> the session token's exp (seconds), for the expiry test
const TOKEN_EXP: Record<string, number> = {};

// The session cookie value is the user id; getToken turns it into a token.
vi.mock("next-auth/jwt", () => ({
  getToken: vi.fn(async ({ req }: any) => {
    const id = req.cookies["next-auth.session-token"];
    return id
      ? { email: `${id.slice(0, 4)}@example.com`, sub: id, ...(TOKEN_EXP[id] && { exp: TOKEN_EXP[id] }) }
      : null;
  }),
}));

vi.mock("@/app/libs/prismadb", () => ({
  default: {
    conversation: {
      findFirst: vi.fn(async ({ where }: any) =>
        MEMBERS[where.id]?.includes(where.userIds.has)
          ? {
              id: where.id,
              isGroup: where.id === GROUP,
              users: MEMBERS[where.id].map((id) => ({ email: emailOf(id) })),
            }
          : null
      ),
      // call-log: the members and the conversation's last message (the call)
      findUnique: vi.fn(async ({ where }: any) =>
        MEMBERS[where.id]
          ? {
              users: MEMBERS[where.id].map((id) => ({ email: emailOf(id) })),
              messages: CALLS[where.id] ? [{ id: CALLS[where.id].id }] : [],
            }
          : null
      ),
    },
    message: {
      findFirst: vi.fn(async ({ where }: any) => CALLS[where.conversationId] ?? null),
      // atomic "move only from the expected status"
      updateMany: vi.fn(async ({ where, data }: any) => {
        const call = callById(where.id);
        if (!call || call.callStatus !== where.callStatus) {
          return { count: 0 };
        }
        Object.assign(call, data);
        return { count: 1 };
      }),
      findUnique: vi.fn(async ({ where }: any) => {
        const call = callById(where.id);
        return call ? { ...call, isCall: true, sender: userOf(call.senderId), seen: [] } : null;
      }),
      // the recent call messages, filtered like the real query (my conversations, not sent by me)
      findMany: vi.fn(async ({ where }: any) =>
        RECENT_CALLS.filter(
          (call) =>
            call.senderId !== where.senderId.not &&
            where.conversationId.in.includes(call.conversationId)
        ).map((call) => ({ ...call, sender: userOf(call.senderId) }))
      ),
    },
    // resendRingingCalls: the user's conversations
    user: {
      findUnique: vi.fn(async ({ where }: any) => ({
        conversationIds: Object.keys(MEMBERS).filter((id) => MEMBERS[id].includes(where.id)),
      })),
    },
  },
}));

import { closeSocketServer, initSocketServer } from "@/server/socket";
import { emitToConversation, removeUserFromConversationRoom } from "@/app/libs/socket-server";
import { callRoom, conversationRoom } from "@/app/libs/socket-rooms";

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
  RECENT_CALLS.length = 0;
  Object.keys(TOKEN_EXP).forEach((id) => delete TOKEN_EXP[id]);
  Object.keys(CALLS).forEach((id) => delete CALLS[id]);
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

  it("tells a 1:1 caller and the callee's tabs about a decline, never strangers", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    const calleeTab1 = (await connected(url, OTHER)).socket;
    const calleeTab2 = (await connected(url, OTHER)).socket;
    const stranger = (await connected(url, STRANGER)).socket;

    const strangerGot = vi.fn();
    stranger.on("call:declined", strangerGot);
    const expected = { roomId: CONVERSATION, by: emailOf(OTHER) };
    const callerGot = next(caller, "call:declined");
    const tab2Got = next(calleeTab2, "call:declined");
    stranger.emit("call:decline", CONVERSATION); // not a member: ignored
    calleeTab1.emit("call:decline", CONVERSATION);

    expect(await callerGot).toEqual(expected);
    expect(await tab2Got).toEqual(expected);
    expect(strangerGot).not.toHaveBeenCalled();
  });

  it("keeps a group call ringing for the others when one member declines", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    const decliner = (await connected(url, OTHER)).socket;

    const callerGot = vi.fn();
    caller.on("call:declined", callerGot);
    const ownTab = next(decliner, "call:declined");
    decliner.emit("call:decline", GROUP);

    expect(await ownTab).toEqual({ roomId: GROUP, by: emailOf(OTHER) });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(callerGot).not.toHaveBeenCalled();
  });

  it("tells the other members when the caller cancels, only from the call room", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    const callee = (await connected(url, OTHER)).socket;
    const third = (await connected(url, THIRD)).socket;

    const calleeGot = vi.fn();
    const callerGot = vi.fn();
    callee.on("call:cancelled", calleeGot);
    caller.on("call:cancelled", callerGot);

    // not in the call room (never joined): ignored
    third.emit("call:cancel", GROUP);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(calleeGot).not.toHaveBeenCalled();

    expect(await joinCall(caller, GROUP)).toEqual({ ok: true, isHost: true });
    const calleeHeard = next(callee, "call:cancelled");
    const thirdHeard = next(third, "call:cancelled");
    caller.emit("call:cancel", GROUP);

    const expected = { roomId: GROUP, by: emailOf(ME) };
    expect(await calleeHeard).toEqual(expected);
    expect(await thirdHeard).toEqual(expected);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(callerGot).not.toHaveBeenCalled(); // not back to the caller
  });

  it("stops the ringing when a waiting caller closes the tab", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    const callee = (await connected(url, OTHER)).socket;

    expect(await joinCall(caller, CONVERSATION)).toEqual({ ok: true, isHost: true });
    const cancelled = next(callee, "call:cancelled");
    caller.close(); // no call:cancel, no call:leave

    expect(await cancelled).toEqual({ roomId: CONVERSATION, by: emailOf(ME) });
  });

  it("stops the ringing only once the last peer leaves the call room", async () => {
    const { url } = await startServer();
    const host = (await connected(url, ME)).socket;
    const guest = (await connected(url, OTHER)).socket;
    const third = (await connected(url, THIRD)).socket;

    await joinCall(host, GROUP);
    await joinCall(guest, GROUP);
    const thirdGot = vi.fn();
    third.on("call:cancelled", thirdGot);

    // the host is still in the room: the call goes on
    guest.emit("call:leave", GROUP);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(thirdGot).not.toHaveBeenCalled();

    // room empty now: a member still ringing stops
    const cancelled = next(third, "call:cancelled");
    host.emit("call:leave", GROUP);
    expect(await cancelled).toEqual({ roomId: GROUP, by: emailOf(ME) });
  });

  it("re-sends a call that is still ringing to a callee who connects late", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    await joinCall(caller, CONVERSATION);
    RECENT_CALLS.push({ conversationId: CONVERSATION, senderId: ME });

    // e.g. the callee's page was loading or its socket reconnecting when call:incoming went out
    const callee = client(url, OTHER);
    const ringing = next(callee, "call:incoming");

    // a call from before audio calls has no callType: re-sent as video
    expect(await ringing).toEqual({ id: CONVERSATION, user: userOf(ME), callType: "video" });
  });

  it("re-sends an audio call as audio", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    await joinCall(caller, CONVERSATION);
    RECENT_CALLS.push({ conversationId: CONVERSATION, senderId: ME, callType: "audio" });

    const ringing = next(client(url, OTHER), "call:incoming");
    expect(await ringing).toEqual({ id: CONVERSATION, user: userOf(ME), callType: "audio" });
  });

  it("does not re-send a call that was answered or abandoned, nor to the caller or strangers", async () => {
    const { url } = await startServer();
    const caller = (await connected(url, ME)).socket;
    const calleeTab = (await connected(url, OTHER)).socket;
    RECENT_CALLS.push({ conversationId: CONVERSATION, senderId: ME });

    const connectsQuietly = async (userId: string) => {
      const socket = client(url, userId);
      const got = vi.fn();
      socket.on("call:incoming", got);
      await next(socket, "presence:list");
      await new Promise((resolve) => setTimeout(resolve, 150));
      expect(got).not.toHaveBeenCalled();
    };

    await joinCall(caller, CONVERSATION);
    await connectsQuietly(ME); // the caller's own other tab
    await connectsQuietly(STRANGER);

    // answered: two peers in the call room
    await joinCall(calleeTab, CONVERSATION);
    await connectsQuietly(OTHER);

    // abandoned: the caller hung up before an answer
    calleeTab.emit("call:leave", CONVERSATION);
    caller.emit("call:leave", CONVERSATION);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await connectsQuietly(OTHER);
  });

  describe("call log (callStatus on the call message)", () => {
    const ringing = () => {
      CALLS[CONVERSATION] = { id: "call-1", senderId: ME, callStatus: "ringing" };
    };

    // a member watching the chat (conversation room), as Body.tsx does
    const watching = async (io: Server, socket: ClientSocket) => {
      socket.emit("conversation:join", CONVERSATION);
      await vi.waitFor(async () => {
        const inRoom = await io.in(conversationRoom(CONVERSATION)).fetchSockets();
        expect(inRoom.map((peer) => peer.id)).toContain(socket.id);
      });
    };

    const updated = (socket: ClientSocket, status: string) =>
      new Promise<any>((resolve) => {
        const handler = (message: any) => {
          if (message.callStatus === status) {
            socket.off("messages:update", handler);
            resolve(message);
          }
        };
        socket.on("messages:update", handler);
      });

    it("logs an answered call, then its end, with both times", async () => {
      ringing();
      const { io, url } = await startServer();
      const caller = (await connected(url, ME)).socket;
      const callee = (await connected(url, OTHER)).socket;
      await watching(io, caller);

      await joinCall(caller, CONVERSATION);
      const answered = updated(caller, "answered");
      const listUpdate = next<any>(callee, "conversation:update");
      await joinCall(callee, CONVERSATION);
      expect((await answered).callAnsweredAt).toBeTruthy();
      // the call is the last message: the conversation lists update too, in place
      expect(await listUpdate).toMatchObject({ id: CONVERSATION, messages: [{ id: "call-1" }] });
      expect((await listUpdate).lastMessageAt).toBeUndefined();

      const ended = updated(caller, "ended");
      callee.emit("call:leave", CONVERSATION);
      const message = await ended;
      expect(new Date(message.callEndedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(message.callAnsweredAt).getTime()
      );
    });

    it("logs a decline before the caller hears it, so the caller's leave doesn't log it missed", async () => {
      ringing();
      const { io, url } = await startServer();
      const caller = (await connected(url, ME)).socket;
      const callee = (await connected(url, OTHER)).socket;
      await joinCall(caller, CONVERSATION);

      const declined = next(caller, "call:declined");
      callee.emit("call:decline", CONVERSATION);
      await declined;
      expect(CALLS[CONVERSATION].callStatus).toBe("declined");

      caller.emit("call:leave", CONVERSATION); // what Room.tsx does on call:declined
      await vi.waitFor(async () =>
        expect(await io.in(callRoom(CONVERSATION)).fetchSockets()).toHaveLength(0)
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(CALLS[CONVERSATION].callStatus).toBe("declined");
      expect(CALLS[CONVERSATION].callEndedAt).toBeInstanceOf(Date);
    });

    it("logs a call nobody answered as missed: the caller cancels or just leaves", async () => {
      ringing();
      const { url } = await startServer();
      const caller = (await connected(url, ME)).socket;
      await joinCall(caller, CONVERSATION);
      caller.emit("call:cancel", CONVERSATION);
      caller.emit("call:leave", CONVERSATION); // as Room.tsx does
      await vi.waitFor(() => expect(CALLS[CONVERSATION].callStatus).toBe("missed"));

      // a second call: the caller (two tabs on the call screen, which is not an answer) closes them
      CALLS[CONVERSATION] = { id: "call-2", senderId: ME, callStatus: "ringing" };
      const tab1 = (await connected(url, ME)).socket;
      const tab2 = (await connected(url, ME)).socket;
      await joinCall(tab1, CONVERSATION);
      await joinCall(tab2, CONVERSATION);
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(CALLS[CONVERSATION].callStatus).toBe("ringing");
      tab1.close();
      tab2.close();
      await vi.waitFor(() => expect(CALLS[CONVERSATION].callStatus).toBe("missed"));
      expect(CALLS[CONVERSATION].callAnsweredAt).toBeUndefined();
    });

    it("never moves a call back: a late no-answer after the callee joined keeps it answered", async () => {
      ringing();
      const { url } = await startServer();
      const caller = (await connected(url, ME)).socket;
      const callee = (await connected(url, OTHER)).socket;
      await joinCall(caller, CONVERSATION);
      await joinCall(callee, CONVERSATION);
      await vi.waitFor(() => expect(CALLS[CONVERSATION].callStatus).toBe("answered"));

      caller.emit("call:cancel", CONVERSATION);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(CALLS[CONVERSATION].callStatus).toBe("answered");
    });
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

  it("picks exactly one host when peers on two instances join at the same time", async () => {
    const [one, two] = await twoInstances();
    for (let round = 0; round < 5; round++) {
      const a = (await connected(one.url, ME)).socket;
      const b = (await connected(two.url, OTHER)).socket;

      const results = await Promise.all([joinCall(a, CONVERSATION), joinCall(b, CONVERSATION)]);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.filter((result) => result.isHost)).toHaveLength(1);
      a.close();
      b.close();
      await vi.waitFor(async () =>
        expect(await one.io.in(callRoom(CONVERSATION)).fetchSockets()).toHaveLength(0)
      );
    }
  });

  it("takes over the host key from a socket that is no longer in the call", async () => {
    const [one, two] = await twoInstances();
    const redis = createClient({ url: process.env.TEST_REDIS_URL });
    await redis.connect();
    // e.g. left behind by an instance that crashed during a call
    await redis.set(`call-host:${GROUP}`, "gone-socket");
    await redis.quit();

    const host = (await connected(one.url, ME)).socket;
    const guest = (await connected(two.url, OTHER)).socket;
    expect(await joinCall(host, GROUP)).toEqual({ ok: true, isHost: true });
    expect(await joinCall(guest, GROUP)).toEqual({ ok: true, isHost: false });
  });
});

describe("socket server lifecycle", () => {
  it("takes every tab of a user out of a conversation room", async () => {
    const { io, url } = await startServer();
    const tab1 = (await connected(url, ME)).socket;
    const tab2 = (await connected(url, ME)).socket;
    const other = (await connected(url, OTHER)).socket;
    [tab1, tab2, other].forEach((socket) => socket.emit("conversation:join", CONVERSATION));
    await vi.waitFor(async () =>
      expect(await io.in(conversationRoom(CONVERSATION)).fetchSockets()).toHaveLength(3)
    );

    removeUserFromConversationRoom(emailOf(ME), CONVERSATION);

    await vi.waitFor(async () => {
      const left = await io.in(conversationRoom(CONVERSATION)).fetchSockets();
      expect(left.map((socket) => socket.data.userId)).toEqual([OTHER]);
    });
  });

  it("drops every socket (clients reconnect) and stops listening on shutdown", async () => {
    const { io, url } = await startServer();
    const { socket } = await connected(url, ME);
    const disconnected = next<string>(socket, "disconnect");

    await closeSocketServer(io, 0);

    // a transport close, not "io server disconnect": socket.io clients only reconnect on their
    // own after the former, and they should, to the instance that replaces this one
    expect(await disconnected).toBe("transport close");
    const error = await next<Error>(client(url, ME), "connect_error");
    expect(error).toBeInstanceOf(Error);
  });
});

describe("typing and session expiry", () => {
  it("relays typing only between sockets in the conversation room, and not too often", async () => {
    const { io, url } = await startServer();
    const a = (await connected(url, ME)).socket;
    const b = (await connected(url, OTHER)).socket;
    const stranger = (await connected(url, STRANGER)).socket;
    a.emit("conversation:join", CONVERSATION);
    b.emit("conversation:join", CONVERSATION);
    await vi.waitFor(async () =>
      expect(await io.in(conversationRoom(CONVERSATION)).fetchSockets()).toHaveLength(2)
    );

    const got = vi.fn();
    b.on("typing", got);
    const strangerGot = vi.fn();
    stranger.on("typing", strangerGot);

    a.emit("typing", CONVERSATION, true);
    a.emit("typing", CONVERSATION, true); // within the interval: dropped
    a.emit("typing", CONVERSATION, false); // "stopped" always goes through
    stranger.emit("typing", CONVERSATION, true); // not in the room: dropped

    await vi.waitFor(() => expect(got).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(got.mock.calls.map(([event]) => event)).toEqual([
      { conversationId: CONVERSATION, email: emailOf(ME), typing: true },
      { conversationId: CONVERSATION, email: emailOf(ME), typing: false },
    ]);
    expect(strangerGot).not.toHaveBeenCalled();
  });

  it("drops the socket's transport when its session expires", async () => {
    const { url } = await startServer();
    TOKEN_EXP[ME] = Math.floor(Date.now() / 1000) + 1;
    const { socket } = await connected(url, ME);
    // a transport close: a real client reconnects and is authenticated again
    expect(await next<string>(socket, "disconnect")).toBe("transport close");
  });
});
