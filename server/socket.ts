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
import { maxCallPeers, type CallPeer } from "../app/libs/call-mesh";
import { getRedisUrl } from "../app/libs/redis-url";
import { activityCache, blockCache, setIO } from "../app/libs/socket-server";
import { blockPartnersOf } from "../app/libs/blocks";
import {
  callRoom,
  conversationRoom,
  userRoom,
} from "../app/libs/socket-rooms";
import { logError } from "../app/libs/log";
import { createPresence, type Presence } from "./presence";
import { ACTIVITY_HIDDEN_ROOM } from "../app/libs/socket-rooms";

interface SocketData {
  email: string;
  userId: string;
  // when the session token (JWT) expires, ms; the socket is dropped then (see scheduleExpiry)
  expiresAt?: number;
  // when this socket joined its current call room; orders the peers for the room's cap
  callJoinedAt?: number;
}

type AppServer = Server<any, any, any, SocketData>;
type AppSocket = Socket<any, any, any, SocketData>;

// WebRTC signalling of the mesh (app/libs/call-mesh.ts), relayed between the peers of a call room
// as { roomId, from, userId, data }. Offer / answer / ICE go to one peer (`to`, its socket id);
// ready and media go to the whole room, or to one peer when `to` is given.
const CALL_DIRECT_SIGNALS = ["call:offer", "call:answer", "call:ice-candidate"] as const;
const CALL_ROOM_SIGNALS = [
  // "my camera / mic are ready": the peers that should offer to the sender do so
  "call:ready",
  // { mic, camera, screen } of the sender, shown as muted / camera off / sharing
  "call:media",
] as const;

type RedisClient = ReturnType<typeof createClient>;

// Strictly increasing join stamps. Plain Date.now() can tie for two joins in the
// same millisecond, and the tie-break could then rank the later peer first: both
// would be admitted to a full room. Wall-clock based so stamps from other instances are roughly
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

// The members' emails per conversation, for relaying "typing" to their inboxes without a
// database lookup per keystroke. Briefly stale after a member change: someone just added misses
// a few seconds of it, and an inbox without that conversation ignores it.
// Cached as promises, so events for one conversation keep their order while it loads.
const MEMBER_CACHE_MS = 30_000;
type Members = { emails: string[]; isGroup: boolean };
const memberCache = new Map<string, { members: Promise<Members>; at: number }>();

const loadMembers = async (conversationId: string): Promise<Members> => {
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { isGroup: true, users: { select: { email: true } } },
  });
  return {
    isGroup: !!conversation?.isGroup,
    emails: (conversation?.users ?? [])
      .map((user) => user.email)
      .filter((email): email is string => !!email),
  };
};

const memberEmails = (conversationId: string) => {
  const cached = memberCache.get(conversationId);
  if (cached && Date.now() - cached.at < MEMBER_CACHE_MS) {
    return cached.members;
  }
  const members = loadMembers(conversationId);
  // a failed load isn't kept
  members.catch(() => memberCache.delete(conversationId));
  memberCache.set(conversationId, { members, at: Date.now() });
  // drop old entries now and then, so the map doesn't grow with every conversation ever typed in
  if (memberCache.size > 1000) {
    const cutoff = Date.now() - MEMBER_CACHE_MS;
    memberCache.forEach((entry, id) => {
      if (entry.at < cutoff) {
        memberCache.delete(id);
      }
    });
  }
  return members;
};

// Who must not see a user's presence or typing, and whose they must not see: everyone they
// blocked or were blocked by (emails). Cached per user on globalThis (blockCache), cleared by
// POST /api/users/[userId]/block here and through "blocks:changed" on the other instances.
const hiddenFor = (email: string) => {
  const cache = blockCache();
  let hidden = cache.get(email);
  if (!hidden) {
    hidden = prisma.user
      .findUnique({ where: { email }, select: { id: true } })
      .then(async (user) => {
        if (!user) {
          return new Set<string>();
        }
        const partners = await blockPartnersOf(user.id);
        return new Set(
          Array.from(partners.values()).filter((partner): partner is string => !!partner)
        );
      })
      .catch((error) => {
        logError("block_partners", error);
        cache.delete(email);
        return new Set<string>();
      });
    cache.set(email, hidden);
  }
  return hidden;
};

// Whether a user hides their activity (User.hideActivity): then no one gets their online /
// offline, and they get no one's. Cached per user on globalThis (activityCache), cleared by
// PATCH /api/settings/privacy here and through "privacy:changed" on the other instances.
const hidesActivity = (email: string) => {
  const cache = activityCache();
  let hidden = cache.get(email);
  if (!hidden) {
    hidden = prisma.user
      .findUnique({ where: { email }, select: { hideActivity: true } })
      .then((user) => !!user?.hideActivity)
      .catch((error) => {
        logError("activity_privacy", error);
        cache.delete(email);
        return false;
      });
    cache.set(email, hidden);
  }
  return hidden;
};

// The ones among these who hide their activity, filling the cache for the unknown ones with one query.
const activityHidersAmong = async (emails: string[]) => {
  const cache = activityCache();
  const unknown = emails.filter((email) => !cache.has(email));
  if (unknown.length > 0) {
    const rows = prisma.user
      .findMany({ where: { email: { in: unknown } }, select: { email: true, hideActivity: true } })
      .catch((error) => {
        logError("activity_privacy", error);
        return null;
      });
    unknown.forEach((email) =>
      cache.set(
        email,
        rows.then((found) => {
          if (!found) {
            cache.delete(email);
            return false;
          }
          return !!found.find((row) => row.email === email)?.hideActivity;
        })
      )
    );
  }
  const flags = await Promise.all(emails.map(hidesActivity));
  return new Set(emails.filter((_, i) => flags[i]));
};

// "Active 5 minutes ago": stamped on every disconnect (only shown while the user is offline, so
// a stamp while another tab stays open is harmless). Fire-and-forget.
const touchLastSeen = (userId: string) => {
  Promise.resolve()
    .then(() => prisma.user.update({ where: { id: userId }, data: { lastSeenAt: new Date() } }))
    .catch((error) => logError("last_seen", error));
};

// The conversation of a call room, for a member: whether it is a group (its cap). Null for a
// stranger, a missing conversation or a malformed id.
const callConversation = async (conversationId: unknown, userId: string) => {
  if (typeof conversationId !== "string") {
    return null;
  }
  try {
    return await prisma.conversation.findFirst({
      where: { id: conversationId, userIds: { has: userId } },
      select: { isGroup: true },
    });
  } catch {
    return null;
  }
};

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
  globalThis.ioClustered = !!redis;
  // online / offline go to everyone here except the user's block partners and the people who hide
  // their activity; nothing goes out for someone who hides theirs
  const announceTo = (event: "presence:online" | "presence:offline", email: string) =>
    hiddenFor(email).then((hidden) => {
      const except = [...Array.from(hidden).map(userRoom), ACTIVITY_HIDDEN_ROOM];
      io.local.except(except).emit(event, email);
    });
  const presence = createPresence(io, {
    clustered: !!redis,
    announce: (event, email) => {
      void hidesActivity(email).then((hides) => {
        if (!hides) {
          return announceTo(event, email);
        }
      });
    },
  });
  // "hide activity" turned on / off (here or on another instance): an online user goes offline /
  // comes back online for the others
  const activityPrivacyChanged = (email: string) => {
    activityCache().delete(email);
    if (!presence.list().includes(email)) {
      return;
    }
    void hidesActivity(email).then((hides) =>
      announceTo(hides ? "presence:offline" : "presence:online", email)
    );
  };
  globalThis.onActivityPrivacyChanged = activityPrivacyChanged;
  io.on("privacy:changed", (email: unknown) => {
    if (typeof email === "string") {
      activityPrivacyChanged(email);
    }
  });
  // a block / unblock on another instance
  io.on("blocks:changed", (emails: unknown) => {
    if (Array.isArray(emails)) {
      emails.forEach((email) => typeof email === "string" && blockCache().delete(email));
    }
  });
  // the online list as this user may see it: nobody when they hide their own activity
  const sendPresenceList = async (socket: AppSocket) => {
    if (await hidesActivity(socket.data.email)) {
      socket.emit("presence:list", []);
      return;
    }
    const online = presence.list();
    const [hidden, hiders] = await Promise.all([
      hiddenFor(socket.data.email),
      activityHidersAmong(online),
    ]);
    socket.emit(
      "presence:list",
      online.filter((email) => !hidden.has(email) && !hiders.has(email))
    );
  };
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
    void hidesActivity(email).then((hides) => hides && socket.join(ACTIVITY_HIDDEN_ROOM));

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
    // join (conversation:join checks), and to the other members' inboxes (conversation:typing,
    // members from memberEmails' cache). The client stops showing it after a few seconds without
    // a refresh, so a lost "stopped" is harmless.
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
      const event = { conversationId, email, typing: isTyping };
      Promise.all([memberEmails(conversationId), hiddenFor(email)])
        .then(([{ emails, isGroup }, hidden]) => {
          const others = emails.filter((member) => member !== email);
          // a blocked 1:1 chat: the other one doesn't see it
          if (!isGroup && others.some((other) => hidden.has(other))) {
            return;
          }
          socket.to(room).emit("typing", event);
          if (others.length > 0) {
            io.to(others.map(userRoom)).emit("conversation:typing", event);
          }
        })
        .catch((error) => logError("typing_members", error));
    });

    // Joining a call: at most maxCallPeers per room (2, a group 4: a mesh, app/libs/call-mesh.ts).
    // Stamp, join and snapshot the room in one synchronous step, then rank by stamp: a peer only
    // ever sees peers that joined before it, all with smaller stamps, so a full room admits nobody
    // more. With Redis, stamps from different instances are only as comparable as their clocks.
    // The ack lists the peers already in (they connect to us once we send call:ready); there is no
    // host, each two peers agree on who offers (isOfferer).
    socket.on(
      "call:join",
      async (
        roomId: unknown,
        ack: (res: { ok: boolean; peers?: CallPeer[]; reason?: "full" }) => void
      ) => {
        if (typeof ack !== "function") {
          return;
        }
        const conversation = await callConversation(roomId, userId);
        if (!conversation) {
          return ack({ ok: false });
        }
        const room = callRoom(roomId as string);
        // no await between these three lines (see above)
        socket.data.callJoinedAt = nextJoinStamp();
        socket.join(room);
        const snapshot = io.in(room).fetchSockets();

        const inRoom = await snapshot;
        const ranked = inRoom
          .map((peer) => ({
            id: peer.id,
            userId: peer.data.userId,
            joinedAt: peer.data.callJoinedAt ?? 0,
          }))
          .sort((a, b) => a.joinedAt - b.joinedAt || a.id.localeCompare(b.id));
        const cap = maxCallPeers(!!conversation.isGroup);
        const position = ranked.findIndex((peer) => peer.id === socket.id);

        if (position < 0 || position >= cap) {
          socket.leave(room);
          return ack({ ok: false, reason: "full" });
        }
        ack({
          ok: true,
          peers: ranked
            .slice(0, cap)
            .filter((peer) => peer.id !== socket.id)
            .map((peer) => ({ id: peer.id, userId: peer.userId })),
        });
        // another user is in (not just the caller's own second tab): the call was answered (call
        // log, after the ack so it never delays it; a no-op once answered)
        if (new Set(ranked.slice(0, cap).map((peer) => peer.userId)).size > 1) {
          void moveCallSafely(io, roomId as string, "answer");
        }
      }
    );

    // Signalling between the peers of a call room (see CALL_DIRECT_SIGNALS). Only from a socket in
    // that room; the server stamps who sent it. A target on this instance that is not in the room
    // is dropped here; on another instance its client drops a signal of a room it is not in.
    const relaySignal = (event: string, roomId: unknown, message: unknown, toRoom: boolean) => {
      if (typeof roomId !== "string") {
        return;
      }
      const room = callRoom(roomId);
      if (!socket.rooms.has(room)) {
        return;
      }
      const { to, data } = (typeof message === "object" && message !== null ? message : {}) as {
        to?: unknown;
        data?: unknown;
      };
      const relayed = { roomId, from: socket.id, userId, data };
      if (typeof to === "string") {
        const local = io.sockets.sockets.get(to);
        if (to !== socket.id && (!local || local.rooms.has(room))) {
          io.to(to).emit(event, relayed);
        }
      } else if (toRoom) {
        socket.to(room).emit(event, relayed);
      }
    };
    CALL_DIRECT_SIGNALS.forEach((event) =>
      socket.on(event, (roomId: unknown, message: unknown) =>
        relaySignal(event, roomId, message, false)
      )
    );
    CALL_ROOM_SIGNALS.forEach((event) =>
      socket.on(event, (roomId: unknown, message: unknown) =>
        relaySignal(event, roomId, message, true)
      )
    );

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
    // Call log: an answered call ends once fewer than two users are left in it (1:1: either one
    // leaving; a group goes on while two talk; the one left alone leaves too, see Room.tsx); a call
    // still ringing when nobody is left was missed.
    const cancelIfLastInCall = async (roomId: string) => {
      try {
        // on a disconnect this socket is still listed
        const peers = (await io.in(callRoom(roomId)).fetchSockets()).filter(
          (peer) => peer.id !== socket.id
        );
        if (new Set(peers.map((peer) => peer.data.userId)).size < 2) {
          await moveCallSafely(io, roomId, "end");
        }
        if (peers.length === 0) {
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
        socket.to(room).emit("call:peer-left", { roomId, from: socket.id });
        socket.leave(room);
        void cancelIfLastInCall(roomId);
      }
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach((room) => {
        if (room.startsWith("call:")) {
          const roomId = room.slice("call:".length);
          socket.to(room).emit("call:peer-left", { roomId, from: socket.id });
          void cancelIfLastInCall(roomId);
        }
      });
    });

    // Presence (server/presence.ts): "online" / "offline" go out when the user's first socket
    // appears / last one leaves anywhere; the new socket gets the whole list from memory.
    socket.on("disconnect", () => {
      presence.remove(email);
      touchLastSeen(userId);
    });
    // asked again after a block / unblock (block:update)
    socket.on("presence:sync", () => void sendPresenceList(socket));
    presence.add(email);
    void sendPresenceList(socket);
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
