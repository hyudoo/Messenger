import type { IncomingMessage, Server as HttpServer } from "http";
import type { NextApiRequest } from "next";
import { Server, Socket } from "socket.io";
import { createAdapter } from "@socket.io/redis-adapter";
import { createClient } from "redis";
import { parse as parseCookie } from "cookie";
import { getToken } from "next-auth/jwt";

import prisma from "../app/libs/prismadb";
import { getRedisUrl } from "../app/libs/redis-url";
import { setIO } from "../app/libs/socket-server";
import {
  callRoom,
  conversationRoom,
  userRoom,
} from "../app/libs/socket-rooms";

interface SocketData {
  email: string;
  userId: string;
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
  return { email: token.email, userId: token.sub };
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
  pubClient.on("error", (error) => console.log(error, "REDIS_PUB_ERROR"));
  subClient.on("error", (error) => console.log(error, "REDIS_SUB_ERROR"));
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
  console.log("> socket.io uses the Redis adapter");
  // the publishing client is not in subscriber mode, so it also runs commands
  return pubClient;
};

// Presence and call rooms are read with fetchSockets(), which asks every
// instance when the Redis adapter is on, instead of counters held in memory.
export const initSocketServer = async (httpServer: HttpServer) => {
  const io: AppServer = new Server(httpServer);
  const redis = await attachRedisAdapter(io);

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

        const peers = (await snapshot)
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
            console.log(error, "ERROR_CALL_HOST");
            socket.leave(room);
            return ack({ ok: false });
          }
        }
        ack({ ok: true, isHost });
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

    socket.on("call:leave", (roomId: unknown) => {
      if (typeof roomId !== "string") {
        return;
      }
      const room = callRoom(roomId);
      if (socket.rooms.has(room)) {
        socket.to(room).emit("call:peer-left");
        socket.leave(room);
      }
    });

    socket.on("disconnecting", () => {
      socket.rooms.forEach((room) => {
        if (room.startsWith("call:")) {
          socket.to(room).emit("call:peer-left");
        }
      });
    });

    // Offline only once no socket of this user is left anywhere. The socket has
    // already left its rooms here, so of two tabs closing together the later
    // check sees none.
    socket.on("disconnect", async () => {
      try {
        const remaining = await io.in(userRoom(email)).fetchSockets();
        if (remaining.length === 0) {
          io.emit("presence:offline", email);
        }
      } catch (error) {
        console.log(error, "ERROR_PRESENCE_OFFLINE");
      }
    });

    // Announced on every connection (clients add idempotently), so tabs that
    // connect at the same time can't race each other out of the announcement.
    try {
      socket.broadcast.emit("presence:online", email);
      const sockets = await io.fetchSockets();
      socket.emit(
        "presence:list",
        Array.from(new Set(sockets.map((peer) => peer.data.email)))
      );
    } catch (error) {
      console.log(error, "ERROR_PRESENCE_LIST");
    }
  });

  setIO(io);
  return io;
};
