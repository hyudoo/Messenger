import { createServer, type Server as HttpServer } from "http";
import type { AddressInfo } from "net";
import { io as connect, type Socket as ClientSocket } from "socket.io-client";
import type { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CONVERSATION, ME, OTHER } from "../helpers";

const THIRD = "ffffffffffffffffffffffff";
const STRANGER = "999999999999999999999999";
const GROUP = "abababababababababababab";

// user id -> the ids they blocked
const BLOCKS: Record<string, string[]> = {};
// user id -> their friends (User.friendIds, both sides)
const FRIENDS: Record<string, string[]> = {};
const ALL_IDS = () => [ME, OTHER, THIRD, STRANGER];

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

const pushMissedCall = vi.hoisted(() => vi.fn());
const lastSeenUpdate = vi.hoisted(() => vi.fn(async () => ({})));
vi.mock("@/app/libs/message-push", () => ({ pushMissedCall }));
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

// users who hide their activity (User.hideActivity)
const HIDERS = vi.hoisted(() => new Set<string>());

vi.mock("@/app/libs/prismadb", () => ({
  default: {
    conversation: {
      // contactsOf: the user's conversations' members
      findMany: vi.fn(async ({ where }: any) =>
        Object.entries(MEMBERS)
          .filter(([, members]) => members.includes(where.userIds.has))
          .map(([, members]) => ({ userIds: members }))
      ),
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
              id: where.id,
              name: null,
              isGroup: where.id === GROUP,
              users: MEMBERS[where.id].map(userOf),
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
      // "active N minutes ago" (touchLastSeen)
      update: lastSeenUpdate,
      findUnique: vi.fn(async ({ where }: any) => {
        if (where.email) {
          const id = ALL_IDS().find((candidate) => emailOf(candidate) === where.email);
          return id ? { id, hideActivity: HIDERS.has(id), friendIds: FRIENDS[id] ?? [] } : null;
        }
        return {
          conversationIds: Object.keys(MEMBERS).filter((id) => MEMBERS[id].includes(where.id)),
          blockedUserIds: BLOCKS[where.id] ?? [],
        };
      }),
      // app/libs/blocks.ts: who blocked a user / the users a user blocked
      findMany: vi.fn(async ({ where }: any) => {
        // server/socket.ts: who among these emails hides their activity
        if (where.email) {
          return ALL_IDS()
            .filter((id) => where.email.in.includes(emailOf(id)))
            .map((id) => ({ email: emailOf(id), hideActivity: HIDERS.has(id) }));
        }
        const ids = where.blockedUserIds
          ? ALL_IDS().filter((id) => (BLOCKS[id] ?? []).includes(where.blockedUserIds.has))
          : where.id.in;
        return ids.map((id: string) => ({ id, email: emailOf(id) }));
      }),
    },
  },
}));

import { closeSocketServer, initSocketServer } from "@/server/socket";
import {
  emitToConversation,
  notifyActivityPrivacyChanged,
  notifyContactsChanged,
  removeUserFromConversationRoom,
} from "@/app/libs/socket-server";
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

type JoinResult = { ok: boolean; peers?: { id: string; userId: string }[]; reason?: string };
const joinCall = (socket: ClientSocket, roomId: string) =>
  new Promise<JoinResult>((resolve) => socket.emit("call:join", roomId, resolve));

// the servers' block caches are global: a test's closing disconnects refill them, so start clean
beforeEach(() => {
  globalThis.blockCache?.clear();
  globalThis.activityCache?.clear();
  globalThis.contactCache?.clear();
});

afterEach(async () => {
  RECENT_CALLS.length = 0;
  pushMissedCall.mockClear();
  Object.keys(TOKEN_EXP).forEach((id) => delete TOKEN_EXP[id]);
  Object.keys(BLOCKS).forEach((id) => delete BLOCKS[id]);
  Object.keys(FRIENDS).forEach((id) => delete FRIENDS[id]);
  HIDERS.clear();
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

  it("runs a mesh call: the peers already in, signals to one peer or the room", async () => {
    const { url } = await startServer();
    const first = (await connected(url, ME)).socket;
    const second = (await connected(url, OTHER)).socket;
    const third = (await connected(url, THIRD)).socket;
    const stranger = (await connected(url, STRANGER)).socket;

    expect(await joinCall(stranger, GROUP)).toEqual({ ok: false });
    expect(await joinCall(first, GROUP)).toEqual({ ok: true, peers: [] });
    expect(await joinCall(second, GROUP)).toEqual({
      ok: true,
      peers: [{ id: first.id, userId: ME }],
    });
    expect(await joinCall(third, GROUP)).toEqual({
      ok: true,
      peers: [
        { id: first.id, userId: ME },
        { id: second.id, userId: OTHER },
      ],
    });

    // call:ready goes to the whole room, stamped with the sender
    const firstReady = next(first, "call:ready");
    const secondReady = next(second, "call:ready");
    third.emit("call:ready", GROUP);
    const stamped = { roomId: GROUP, from: third.id, userId: THIRD };
    expect(await firstReady).toEqual(stamped);
    expect(await secondReady).toEqual(stamped);

    // an offer goes to its peer only
    const secondGot = vi.fn();
    second.on("call:offer", secondGot);
    const offer = next(third, "call:offer");
    first.emit("call:offer", GROUP, { to: third.id, data: { type: "offer", sdp: "x" } });
    expect(await offer).toEqual({
      roomId: GROUP,
      from: first.id,
      userId: ME,
      data: { type: "offer", sdp: "x" },
    });

    // nothing to a socket outside the room, nor from one
    const strangerGot = vi.fn();
    stranger.on("call:offer", strangerGot);
    first.emit("call:offer", GROUP, { to: stranger.id, data: {} });
    stranger.emit("call:offer", GROUP, { to: first.id, data: {} });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(strangerGot).not.toHaveBeenCalled();
    expect(secondGot).not.toHaveBeenCalled();

    // leaving tells the others who left
    const left = next(first, "call:peer-left");
    second.emit("call:leave", GROUP);
    expect(await left).toEqual({ roomId: GROUP, from: second.id });
  });

  it("caps a call: two peers in a 1:1 chat, four in a group", async () => {
    const { url } = await startServer();
    const tabs = await Promise.all([ME, OTHER, ME].map((id) => connected(url, id)));
    expect(await joinCall(tabs[0].socket, CONVERSATION)).toMatchObject({ ok: true });
    expect(await joinCall(tabs[1].socket, CONVERSATION)).toMatchObject({ ok: true });
    expect(await joinCall(tabs[2].socket, CONVERSATION)).toEqual({ ok: false, reason: "full" });

    const group = await Promise.all([ME, OTHER, THIRD, ME, OTHER].map((id) => connected(url, id)));
    for (const { socket } of group.slice(0, 4)) {
      expect(await joinCall(socket, GROUP)).toMatchObject({ ok: true });
    }
    expect(await joinCall(group[4].socket, GROUP)).toEqual({ ok: false, reason: "full" });
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

    expect(await joinCall(caller, GROUP)).toMatchObject({ ok: true });
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

    expect(await joinCall(caller, CONVERSATION)).toMatchObject({ ok: true });
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
      // the callee gets a "missed call" push (not the caller)
      expect(pushMissedCall).toHaveBeenCalledTimes(1);
      expect(pushMissedCall).toHaveBeenCalledWith(
        expect.objectContaining({
          conversation: expect.objectContaining({ id: CONVERSATION }),
          sender: expect.objectContaining({ id: ME }),
          recipientIds: [OTHER],
        })
      );

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

    it("keeps a group call going while two people are in it", async () => {
      CALLS[GROUP] = { id: "call-g", senderId: ME, callStatus: "ringing" };
      const { url } = await startServer();
      const [a, b, c] = await Promise.all([ME, OTHER, THIRD].map((id) => connected(url, id)));
      await joinCall(a.socket, GROUP);
      await joinCall(b.socket, GROUP);
      await joinCall(c.socket, GROUP);
      await vi.waitFor(() => expect(CALLS[GROUP].callStatus).toBe("answered"));

      // two still talking
      b.socket.emit("call:leave", GROUP);
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(CALLS[GROUP].callStatus).toBe("answered");

      // one left alone: over
      c.socket.close();
      await vi.waitFor(() => expect(CALLS[GROUP].callStatus).toBe("ended"));
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

  it("admits both peers when they join at the same time", async () => {
    const { url } = await startServer();
    const a = (await connected(url, ME)).socket;
    const b = (await connected(url, OTHER)).socket;

    const results = await Promise.all([joinCall(a, CONVERSATION), joinCall(b, CONVERSATION)]);

    // each finds the other through call:ready if not in its list
    expect(results.every((result) => result.ok)).toBe(true);
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

  it("gives an instance started later the users online on the others", async () => {
    vi.stubEnv("REDIS_URL", process.env.TEST_REDIS_URL!);
    const one = await startServer();
    await connected(one.url, ME);

    const two = await startServer();
    const b = await connected(two.url, OTHER);
    // in its first list, or announced once the older instance answered the new one's hello
    const online = new Set(b.online);
    b.socket.on("presence:online", (email: string) => online.add(email));
    await vi.waitFor(() => expect(online.has(emailOf(ME))).toBe(true));
  });

  it("keeps a user online while a tab on either instance is left", async () => {
    const [one, two] = await twoInstances();
    const watcher = (await connected(one.url, OTHER)).socket;
    const tabOne = (await connected(one.url, ME)).socket;
    const tabTwo = (await connected(two.url, ME)).socket;
    const offline = vi.fn();
    watcher.on("presence:offline", offline);
    // instance one hears about the tab on instance two through Redis (a few ms); before that a
    // close here would flicker offline -> online
    await new Promise((resolve) => setTimeout(resolve, 100));

    tabOne.close();
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(offline).not.toHaveBeenCalled();

    tabTwo.close();
    await vi.waitFor(() => expect(offline).toHaveBeenCalledWith(emailOf(ME)));
  });

  it("runs a call whose peers are on different instances", async () => {
    const [one, two] = await twoInstances();
    const host = (await connected(one.url, ME)).socket;
    const guest = (await connected(two.url, OTHER)).socket;
    const third = (await connected(two.url, THIRD)).socket;

    const stranger = (await connected(two.url, STRANGER)).socket;

    expect(await joinCall(host, GROUP)).toEqual({ ok: true, peers: [] });
    expect(await joinCall(guest, GROUP)).toEqual({ ok: true, peers: [{ id: host.id, userId: ME }] });
    expect(await joinCall(third, GROUP)).toMatchObject({ ok: true });
    expect(await joinCall(stranger, GROUP)).toEqual({ ok: false });

    // to one peer on the other instance
    const offer = next(guest, "call:offer");
    host.emit("call:offer", GROUP, { to: guest.id, data: { type: "offer", sdp: "y" } });
    expect(await offer).toEqual({
      roomId: GROUP,
      from: host.id,
      userId: ME,
      data: { type: "offer", sdp: "y" },
    });
    // to the room, across instances
    const ready = next(host, "call:ready");
    third.emit("call:ready", GROUP);
    expect(await ready).toMatchObject({ from: third.id, userId: THIRD });
  });

  it("clears the block cache on the other instance (blocks:changed)", async () => {
    const [one, two] = await twoInstances();
    // OTHER (on instance two) blocked ME: the cached filter hides ME from them
    BLOCKS[OTHER] = [ME];
    const b = await connected(two.url, OTHER);
    await connected(one.url, ME);
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(globalThis.blockCache?.has(emailOf(OTHER))).toBe(true);

    // unblocked on instance one. Both instances share globalThis in this process, and an
    // instance doesn't receive its own serverSideEmit, so only instance two's handler can clear it
    delete BLOCKS[OTHER];
    one.io.serverSideEmit("blocks:changed", [emailOf(OTHER), emailOf(ME)]);
    await vi.waitFor(() => expect(globalThis.blockCache?.has(emailOf(OTHER))).toBe(false));

    // the refreshed list on instance two shows ME again
    const list = next<string[]>(b.socket, "presence:list");
    b.socket.emit("presence:sync");
    expect(await list).toContain(emailOf(ME));
  });

  it("admits both peers when they join on two instances at the same time", async () => {
    const [one, two] = await twoInstances();
    for (let round = 0; round < 3; round++) {
      const a = (await connected(one.url, ME)).socket;
      const b = (await connected(two.url, OTHER)).socket;

      const results = await Promise.all([joinCall(a, CONVERSATION), joinCall(b, CONVERSATION)]);

      expect(results.every((result) => result.ok)).toBe(true);
      a.close();
      b.close();
      await vi.waitFor(async () =>
        expect(await one.io.in(callRoom(CONVERSATION)).fetchSockets()).toHaveLength(0)
      );
    }
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

describe("presence scope (contacts)", () => {
  it("shares presence only with friends and people in a shared conversation", async () => {
    const { url } = await startServer();
    // ME shares a conversation with OTHER; STRANGER shares none with anyone
    const a = (await connected(url, ME)).socket;
    const aOnline = vi.fn();
    a.on("presence:online", aOnline);

    const stranger = await connected(url, STRANGER);
    // only themselves
    expect(stranger.online).toEqual([emailOf(STRANGER)]);
    const b = await connected(url, OTHER);
    expect(b.online).toContain(emailOf(ME));
    expect(b.online).not.toContain(emailOf(STRANGER));
    await vi.waitFor(() => expect(aOnline).toHaveBeenCalledWith(emailOf(OTHER)));
    expect(aOnline).not.toHaveBeenCalledWith(emailOf(STRANGER));

    // ME and STRANGER become friends: both tabs are told, and the lists now have each other
    FRIENDS[ME] = [STRANGER];
    FRIENDS[STRANGER] = [ME];
    const told = next<{ friends: boolean }>(stranger.socket, "contacts:update");
    notifyContactsChanged([emailOf(ME), emailOf(STRANGER)], true);
    expect(await told).toEqual({ friends: true });
    const list = next<string[]>(stranger.socket, "presence:list");
    stranger.socket.emit("presence:sync");
    expect((await list).sort()).toEqual([emailOf(ME), emailOf(STRANGER)].sort());

    // and STRANGER going offline now reaches ME, not OTHER
    const aOffline = next<string>(a, "presence:offline");
    const bOffline = vi.fn();
    b.socket.on("presence:offline", bOffline);
    stranger.socket.close();
    expect(await aOffline).toBe(emailOf(STRANGER));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(bOffline).not.toHaveBeenCalled();
  });
});

describe("blocking", () => {
  it("hides presence both ways between block partners, not from others", async () => {
    BLOCKS[ME] = [OTHER];
    const { url } = await startServer();
    const a = (await connected(url, ME)).socket;
    const c = (await connected(url, THIRD)).socket;
    const aOnline = vi.fn();
    a.on("presence:online", aOnline);
    const cOnline = vi.fn();
    c.on("presence:online", cOnline);

    const b = await connected(url, OTHER);
    // OTHER's list leaves out ME, and ME isn't told OTHER came online; THIRD sees both
    expect(b.online).not.toContain(emailOf(ME));
    expect(b.online).toContain(emailOf(THIRD));
    await vi.waitFor(() => expect(cOnline).toHaveBeenCalledWith(emailOf(OTHER)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(aOnline).not.toHaveBeenCalledWith(emailOf(OTHER));
  });

  it("drops typing in a blocked 1:1 chat", async () => {
    BLOCKS[OTHER] = [ME];
    const { io, url } = await startServer();
    const a = (await connected(url, ME)).socket;
    const b = (await connected(url, OTHER)).socket;
    a.emit("conversation:join", CONVERSATION);
    b.emit("conversation:join", CONVERSATION);
    await vi.waitFor(async () =>
      expect(await io.in(conversationRoom(CONVERSATION)).fetchSockets()).toHaveLength(2)
    );
    const got = vi.fn();
    b.on("typing", got);
    b.on("conversation:typing", got);
    a.emit("typing", CONVERSATION, true);
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(got).not.toHaveBeenCalled();
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

  it("also tells the other members' inboxes, not the typist's own", async () => {
    const { io, url } = await startServer();
    const a = (await connected(url, ME)).socket;
    const inboxB = (await connected(url, OTHER)).socket; // not in the chat
    const inboxA = (await connected(url, ME)).socket; // the typist's other tab
    const stranger = (await connected(url, STRANGER)).socket;
    a.emit("conversation:join", CONVERSATION);
    await vi.waitFor(async () =>
      expect(await io.in(conversationRoom(CONVERSATION)).fetchSockets()).toHaveLength(1)
    );

    const got = vi.fn();
    inboxB.on("conversation:typing", got);
    const own = vi.fn();
    inboxA.on("conversation:typing", own);
    const strangerGot = vi.fn();
    stranger.on("conversation:typing", strangerGot);

    a.emit("typing", CONVERSATION, true);
    await vi.waitFor(() =>
      expect(got).toHaveBeenCalledWith({ conversationId: CONVERSATION, email: emailOf(ME), typing: true })
    );
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(own).not.toHaveBeenCalled();
    expect(strangerGot).not.toHaveBeenCalled();
  });

  it("stamps lastSeenAt when a socket disconnects", async () => {
    const { url } = await startServer();
    const { socket } = await connected(url, ME);
    lastSeenUpdate.mockClear();
    socket.disconnect();
    await vi.waitFor(() =>
      expect(lastSeenUpdate).toHaveBeenCalledWith({
        where: { id: ME },
        data: { lastSeenAt: expect.any(Date) },
      })
    );
  });

  it("drops the socket's transport when its session expires", async () => {
    const { url } = await startServer();
    TOKEN_EXP[ME] = Math.floor(Date.now() / 1000) + 1;
    const { socket } = await connected(url, ME);
    // a transport close: a real client reconnects and is authenticated again
    expect(await next<string>(socket, "disconnect")).toBe("transport close");
  });
});

describe("hidden activity", () => {
  it("leaves a user who hides their activity out of presence, and them out of everyone's", async () => {
    HIDERS.add(ME);
    const { url } = await startServer();
    const c = (await connected(url, THIRD)).socket;
    const cOnline = vi.fn();
    c.on("presence:online", cOnline);

    const a = await connected(url, ME);
    // ME sees nobody, and nobody hears ME come online
    expect(a.online).toEqual([]);
    const aOnline = vi.fn();
    a.socket.on("presence:online", aOnline);
    const b = await connected(url, OTHER);
    expect(b.online).toContain(emailOf(THIRD));
    expect(b.online).not.toContain(emailOf(ME));
    await vi.waitFor(() => expect(cOnline).toHaveBeenCalledWith(emailOf(OTHER)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(cOnline).not.toHaveBeenCalledWith(emailOf(ME));
    expect(aOnline).not.toHaveBeenCalled();
  });

  it("announces the user offline when they turn it on, and online again when they turn it off", async () => {
    const { url } = await startServer();
    await connected(url, ME);
    const c = (await connected(url, THIRD)).socket;
    const offline = vi.fn();
    const online = vi.fn();
    c.on("presence:offline", offline);
    c.on("presence:online", online);

    HIDERS.add(ME);
    notifyActivityPrivacyChanged(emailOf(ME), true);
    await vi.waitFor(() => expect(offline).toHaveBeenCalledWith(emailOf(ME)));

    HIDERS.delete(ME);
    notifyActivityPrivacyChanged(emailOf(ME), false);
    await vi.waitFor(() => expect(online).toHaveBeenCalledWith(emailOf(ME)));
  });
});
