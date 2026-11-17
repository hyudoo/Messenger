import type { IncomingMessage, Server as HttpServer } from "http";
import type { NextApiRequest } from "next";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { parse as parseCookie } from "cookie";
import { getToken } from "next-auth/jwt";

import prisma from "../app/libs/prismadb";
import { CALL_RING_TIMEOUT_MS } from "../app/libs/call";
import { moveCallSafely } from "./call-log";
import { getRedisUrl } from "../app/libs/redis-url";
import { setIO } from "../app/libs/socket-server";
import {
  callRoom,
  conversationRoom,
  userRoom,
} from "../app/libs/socket-rooms";
import { logError } from "../app/libs/log";
import { createPresence, type Presence } from "./presence";

interface SocketData {
  email: string;
  userId: string;
  // when the session token (JWT) expires, ms; the socket is dropped then (see scheduleExpiry)
  expiresAt?: number;
  // when this socket joined its current call room; orders host / second peer
  callJoinedAt?: number;
}

type AppServer = Server<any, any, any, SocketData>;
type AppSocket = Socket<any, any, any, SocketData>;

const CALL_SIGNALS = [
  "call:ready",
  "call:offer",
  "call:answer",
  "call:ice-candidate",
  // { mic, camera } of the sender, so the other side can show it muted / camera off
  "call:media",
] as const;

const MAX_CALL_PEERS = 2;

type RedisClient = ReturnType<typeof createClient>;

// Call host with several instances: the host is the socket whose id is stored in
// call-host:<roomId>. Unlike join stamps this does not depend on the instances'
// clocks. The TTL only cleans up keys of finished calls; a holder that is gone
// (call ended, instance crashed) is replaced through compare-and-swap.
const CALL_HOST_TTL_MS = 24 * 60 * 60 * 1000;
const callHostKey = (roomId: string) => `call-host:${roomId}`;
const CLAIM_IF_EMPTY = `
local holder = redis.call('GET', KEYS[1])
if holder then return holder end
redis.call('SET', KEYS[1], ARGV[1], 'PX', ARGV[2])
return ARGV[1]`;
const REPLACE_IF_HOLDER = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  redis.call('SET', KEYS[1], ARGV[2], 'PX', ARGV[3])
  return 1
end
return 0`;

const claimCallHost = async (
  redis: RedisClient,
  io: AppServer,
  roomId: string,
  socketId: string
): Promise<boolean> => {
  const key = callHostKey(roomId);
  const ttl = String(CALL_HOST_TTL_MS);
  const holder = await redis.eval(CLAIM_IF_EMPTY, {
    keys: [key],
    arguments: [socketId, ttl],
  });
  if (holder === socketId) {
    return true;
  }
  // fetched after the holder wrote the key, so a holder still in the call shows up
  const present = await io.in(callRoom(roomId)).fetchSockets();
  if (present.some((peer) => peer.id === holder)) {
    return false;
  }
  // stale holder; of several sockets replacing it only one succeeds
  const replaced = await redis.eval(REPLACE_IF_HOLDER, {
    keys: [key],
    arguments: [String(holder), socketId, ttl],
  });
  return replaced === 1;
};

// Strictly increasing join stamps. Plain Date.now() can tie for two joins in the
// same millisecond, and the tie-break could then rank the later peer first: both
// would become host. Wall-clock based so stamps from other instances are roughly
// comparable (see the call:join comment for what is left of the race).
let lastJoinStamp = 0;
const nextJoinStamp = () => (lastJoinStamp = Math.max(Date.now(), lastJoinStamp + 1));

const authenticate = async (req: IncomingMessage) => {
  // getToken only reads `req.cookies`, so hand it the parsed cookie header.
  const cookies = parseCookie(req.headers.cookie ?? "");
  const token = await getToken({
    req: { cookies, headers: req.headers } as unknown as NextApiRequest,
    secret: process.env.NEXTAUTH_SECRET,
  });

  if (!token?.email || !token.sub) {
    return null;
  }
  return {
    email: token.email,
    userId: token.sub,
    expiresAt: typeof token.exp === "number" ? token.exp * 1000 : undefined,
  };
};

// setTimeout overflows past ~24.8 days (sessions last 30)
const MAX_TIMER_MS = 2 ** 31 - 1;

// The socket was authenticated once, with the session cookie of that moment. When that session
// expires, close the transport: the client reconnects on its own and the auth middleware checks
// the cookie again (refreshed by next-auth while the user is active), or refuses a signed-out one.
const scheduleExpiry = (socket: AppSocket) => {
  const { expiresAt } = socket.data;
  if (!expiresAt) {
    return;
  }
  let timer: ReturnType<typeof setTimeout>;
  const arm = () => {
    const delay = expiresAt - Date.now();
    timer =
      delay > MAX_TIMER_MS
        ? setTimeout(arm, MAX_TIMER_MS)
        : setTimeout(() => socket.conn.close(), Math.max(delay, 0));
  };
  arm();
  socket.on("disconnect", () => clearTimeout(timer));
};

// "typing" relays: at most one "started typing" per socket per this interval (clients send one
// every few seconds while typing; this only stops a flood)
const TYPING_MIN_INTERVAL_MS = 1000;

const isMember = async (conversationId: unknown, userId: string) => {
  if (typeof conversationId !== "string") {
    return false;
  }
  try {
    const conversation = await prisma.conversation.findFirst({
      where: { id: conversationId, userIds: { has: userId } },
      select: { id: true },
    });
    return !!conversation;
  } catch {
    // malformed ObjectId
    return false;
  }
};

// call:incoming is a one-off emit to the callee's user room: a callee whose socket was down at that
// moment (page loading, reconnecting after sleep or a network change) or who opens the app while it
// rings would never hear it. So on every connection, re-send this socket the calls still ringing for
// its user: a call message from someone else, started within the ring time, whose call room holds
// exactly one peer and that peer is the caller (alone, waiting). Answered (two peers), declined or
// abandoned (caller gone) calls are not re-sent.
const resendRingingCalls = async (io: AppServer, socket: AppSocket) => {
  const { userId } = socket.data;
  // runs on every connection: the user's conversation ids first, so the call query uses the
  // (conversationId, createdAt) index instead of a relation filter (a $lookup over messages)
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { conversationIds: true },
  });
  if (!user || user.conversationIds.length === 0) {
    return;
  }
  const calls = await prisma.message.findMany({
    where: {
      conversationId: { in: user.conversationIds },
      isCall: true,
      createdAt: { gte: new Date(Date.now() - CALL_RING_TIMEOUT_MS) },
      senderId: { not: userId },
    },
    orderBy: { createdAt: "desc" },
    select: { conversationId: true, senderId: true, sender: true, callType: true },
  });

  const latestPerConversation = new Map<string, (typeof calls)[number]>();
  calls.forEach((call) => {
    if (!latestPerConversation.has(call.conversationId)) {
      latestPerConversation.set(call.conversationId, call);
    }
  });

  await Promise.all(
    Array.from(latestPerConversation.values()).map(async (call) => {
      const peers = await io.in(callRoom(call.conversationId)).fetchSockets();
      if (peers.length === 1 && peers[0].data.userId === call.senderId) {
        socket.emit("call:incoming", {
          id: call.conversationId,
          user: call.sender,
          callType: call.callType ?? "video",
        });
      }
    })
  );
};

// the Redis adapter's connections, closed by closeSocketServer
let adapterClients: RedisClient[] = [];
// each server's presence, stopped by closeSocketServer (tests run several servers in one process)
const presences = new WeakMap<AppServer, Presence>();

// With Redis configured (REDIS_URL or REDIS_HOST), sockets on every instance
// share rooms through Redis, so emits (including emitToUser/emitToConversation
// from route handlers) reach all of them. Without it everything stays in this
// process.
const attachRedisAdapter = async (io: AppServer): Promise<RedisClient | null> => {
  const url = getRedisUrl();
  if (!url) {
    return null;
  }
  const pubClient = createClient({ url });
  const subClient = pubClient.duplicate();
  pubClient.on("error", (error) => logError("redis_pub", error));
  subClient.on("error", (error) => logError("redis_sub", error));
  // node-redis retries forever without settling connect(); fail the boot instead
  // of hanging silently when Redis is unreachable at startup
  await Promise.race([
    Promise.all([pubClient.connect(), subClient.connect()]),
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`Redis (REDIS_URL / REDIS_HOST) not reachable within 10s`)),
        10_000
      )
    ),
  ]);
  io.adapter(createAdapter(pubClient, subClient));
  adapterClients = [pubClient, subClient];
  console.log("> socket.io uses the Redis adapter");
  // the publishing client is not in subscriber mode, so it also runs commands
  return pubClient;
};

// Call rooms are read with fetchSockets(), which asks every instance when the Redis adapter is on,
// instead of counters held in memory. Presence is kept by server/presence.ts (per-instance counts
// shared between instances), since it would otherwise ask the whole cluster on every connection.
export const initSocketServer = async (httpServer: HttpServer) => {
  const io: AppServer = new Server(httpServer);
  const redis = await attachRedisAdapter(io);
  const presence = createPresence(io, { clustered: !!redis });
  presences.set(io, presence);

  io.use(async (socket, next) => {
    const user = await authenticate(socket.request).catch(() => null);
    if (!user) {
      return next(new Error("Unauthorized"));
    }
    socket.data = user;
    next();
  });

  io.on("connection", async (socket: AppSocket) => {
    const { email, userId } = socket.data;

    socket.join(userRoom(email));
    scheduleExpiry(socket);

    resendRingingCalls(io, socket).catch((error) =>
      logError("resend_ringing_calls", error)
    );

    socket.on("conversation:join", async (conversationId: unknown) => {
      if (await isMember(conversationId, userId)) {
        socket.join(conversationRoom(conversationId as string));
      }
    });

    socket.on("conversation:leave", (conversationId: unknown) => {
      if (typeof conversationId === "string") {
        socket.leave(conversationRoom(conversationId));
      }
    });

    // "X is typing…": relayed to the others in the conversation room, which only members can
    // join (conversation:join checks), so no database lookup per keystroke. The client stops
    // showing it after a few seconds without a refresh, so a lost "stopped" is harmless.
    let lastTypingAt = 0;
    socket.on("typing", (conversationId: unknown, typing: unknown) => {
      if (typeof conversationId !== "string") {
        return;
      }
      const room = conversationRoom(conversationId);
      if (!socket.rooms.has(room)) {
        return;
      }
      const isTyping = typing === true;
      if (isTyping) {
        const now = Date.now();
        if (now - lastTypingAt < TYPING_MIN_INTERVAL_MS) {
          return;
        }
        lastTypingAt = now;
      }
      socket.to(room).emit("typing", { conversationId, email, typing: isTyping });
    });

    // Video call: at most two peers per room. Stamp, join and snapshot the room
    // in one synchronous step, then rank by stamp: a peer only ever sees peers
    // that joined before it, all with smaller stamps, so exactly one is host.
    // With Redis, stamps from different instances are only as comparable as their
    // clocks, so they only admit peers and the host is picked by claimCallHost.
    socket.on(
      "call:join",
      async (
        roomId: unknown,
        ack: (res: { ok: boolean; isHost?: boolean }) => void
      ) => {
        if (typeof ack !== "function") {
          return;
        }
        if (!(await isMember(roomId, userId))) {
          return ack({ ok: false });
        }
        const room = callRoom(roomId as string);
        // no await between these three lines (see above)
        socket.data.callJoinedAt = nextJoinStamp();
        socket.join(room);
        const snapshot = io.in(room).fetchSockets();

        const inRoom = await snapshot;
        const peers = inRoom
          .map((peer) => ({ id: peer.id, joinedAt: peer.data.callJoinedAt ?? 0 }))
          .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
        const position = peers.findIndex((peer) => peer.id === socket.id);

        if (position < 0 || position >= MAX_CALL_PEERS) {
          socket.leave(room);
          return ack({ ok: false });
        }
        let isHost = position === 0;
        if (redis) {
          try {
            isHost = await claimCallHost(redis, io, roomId as string, socket.id);
          } catch (error) {
            logError("call_host", error);
            socket.leave(room);
            return ack({ ok: false });
          }
        }
        ack({ ok: true, isHost });
        // the second peer is in and it's another user (not the caller's own second tab): the call was
        // answered (call log, after the ack so it never delays it)
        if (position === 1 && new Set(inRoom.map((peer) => peer.data.userId)).size > 1) {
          void moveCallSafely(io, roomId as string, "answer");
        }
      }
    );

    // WebRTC signalling is relayed as-is to the other peer in the room.
    CALL_SIGNALS.forEach((event) => {
      socket.on(event, (roomId: unknown, payload: unknown) => {
        if (typeof roomId !== "string") {
          return;
        }
        const room = callRoom(roomId);
        if (socket.rooms.has(room)) {
          socket.to(room).emit(event, payload);
        }
      });
    });

    // The callee declined a ringing call. 1:1: every member's tabs hear it (the
    // caller's call screen leaves, the callee's other tabs stop ringing). Group:
    // the others may still answer, so only the decliner's own tabs hear it.
    socket.on("call:decline", async (roomId: unknown) => {
      if (typeof roomId !== "string") {
        return;
      }
      const conversation = await prisma.conversation
        .findFirst({
          where: { id: roomId, userIds: { has: userId } },
          select: { isGroup: true, users: { select: { email: true } } },
        })
        .catch(() => null); // malformed ObjectId
      if (!conversation) {
        return;
      }
      // logged before call:declined goes out: the caller's call screen leaves on it, and that leave
      // must find the call already declined (not still ringing, which would log it as missed)
      if (!conversation.isGroup) {
        await moveCallSafely(io, roomId, "decline");
      }
      const emails = conversation.isGroup
        ? [email]
        : conversation.users.flatMap((user) => (user.email ? [user.email] : []));
      io.to(emails.map(userRoom)).emit("call:declined", { roomId, by: email });
    });

    // Stops the ringing for this call on the other members' tabs (call:cancelled;
    // IncomingCall closes the modal). Also not re-sent on reconnect afterwards:
    // resendRingingCalls needs the caller in the call room.
    const notifyCancelled = async (roomId: string) => {
      const conversation = await prisma.conversation
        .findFirst({
          where: { id: roomId, userIds: { has: userId } },
          select: { users: { select: { email: true } } },
        })
        .catch(() => null); // malformed ObjectId
      if (!conversation) {
        return;
      }
      const others = conversation.users.flatMap((user) =>
        user.email && user.email !== email ? [user.email] : []
      );
      if (others.length > 0) {
        io.to(others.map(userRoom)).emit("call:cancelled", { roomId, by: email });
      }
    };

    // Whenever the last peer leaves a call room, nobody is left to answer, so stop
    // any ringing for it: covers a caller who closes the tab, goes Back or loses
    // the connection while waiting (no call:cancel then). After a call that was
    // answered it is a no-op for the other side (nothing rings) and stops members
    // of a group who were still ringing.
    // Call log: either peer leaving ends an answered call (the other one leaves too, see Room.tsx);
    // a call still ringing when nobody is left was missed.
    const cancelIfLastInCall = async (roomId: string) => {
      try {
        await moveCallSafely(io, roomId, "end");
        const peers = await io.in(callRoom(roomId)).fetchSockets();
        if (peers.every((peer) => peer.id === socket.id)) {
          await notifyCancelled(roomId);
          await moveCallSafely(io, roomId, "miss");
        }
      } catch (error) {
        logError("call_cancel", error);
      }
    };

    // The caller hung up (or gave up, no answer) before anyone picked up. Only a
    // socket in the call room may cancel (checked before any await).
    socket.on("call:cancel", (roomId: unknown) => {
      if (typeof roomId !== "string" || !socket.rooms.has(callRoom(roomId))) {
        return;
      }
      notifyCancelled(roomId).catch((error) => logError("call_cancel", error));
      void moveCallSafely(io, roomId, "miss");
    });

    socket.on("call:leave", (roomId: unknown) => {
      if (typeof roomId !== "string") {
        return;
      }
      const room = callRoom(roomId);
      if (socket.rooms.has(room)) {
        socket.to(room).emit("call:peer-left");
        socket.leave(room);
        void cancelIfLastInCall(roomId);
      }
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach((room) => {
        if (room.startsWith("call:")) {
          socket.to(room).emit("call:peer-left");
          void cancelIfLastInCall(room.slice("call:".length));
        }
      });
    });

    // Presence (server/presence.ts): "online" / "offline" go out when the user's first socket
    // appears / last one leaves anywhere; the new socket gets the whole list from memory.
    socket.on("disconnect", () => presence.remove(email));
    presence.add(email);
    socket.emit("presence:list", presence.list());
  });

  setIO(io);
  return io;
};

// Graceful shutdown (server.ts, on SIGTERM / SIGINT): drops every socket (a transport close, so
// clients reconnect on their own, to the next instance), which runs the
// disconnect handlers (peer-left, call log, offline), and stops the HTTP server it is attached
// to. Waits for those handlers' pending database writes before closing Redis.
export const closeSocketServer = async (io: AppServer, settleMs = 1000) => {
  await new Promise<void>((resolve) => io.close(() => resolve()));
  // the call-log moves started by the disconnects are fire-and-forget; give them a moment
  await new Promise((resolve) => setTimeout(resolve, settleMs));
  // after the disconnects, which sent their "offline" changes; Redis is still open here
  presences.get(io)?.stop();
  await Promise.all(
    adapterClients.map((client) => client.close().catch(() => client.destroy()))
  );
  adapterClients = [];
};
