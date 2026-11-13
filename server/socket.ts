import type { IncomingMessage, Server as HttpServer } from "http";
import type { NextApiRequest } from "next";
import { Server, Socket } from "socket.io";
import { parse as parseCookie } from "cookie";
import { getToken } from "next-auth/jwt";

import prisma from "../app/libs/prismadb";
import { setIO } from "../app/libs/socket-server";
import {
  callRoom,
  conversationRoom,
  userRoom,
} from "../app/libs/socket-rooms";

interface SocketData {
  email: string;
  userId: string;
}

type AppSocket = Socket<any, any, any, SocketData>;

const CALL_SIGNALS = [
  "call:ready",
  "call:offer",
  "call:answer",
  "call:ice-candidate",
] as const;

// email -> number of open sockets (one user can have several tabs)
const onlineCounts = new Map<string, number>();

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

export const initSocketServer = (httpServer: HttpServer) => {
  const io = new Server<any, any, any, SocketData>(httpServer);

  io.use(async (socket, next) => {
    const user = await authenticate(socket.request).catch(() => null);
    if (!user) {
      return next(new Error("Unauthorized"));
    }
    socket.data = user;
    next();
  });

  io.on("connection", (socket: AppSocket) => {
    const { email, userId } = socket.data;

    socket.join(userRoom(email));

    const count = onlineCounts.get(email) ?? 0;
    onlineCounts.set(email, count + 1);
    if (count === 0) {
      socket.broadcast.emit("presence:online", email);
    }
    socket.emit("presence:list", Array.from(onlineCounts.keys()));

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

    // Video call: two peers per room, the first one to join is the host.
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
        const size = io.sockets.adapter.rooms.get(room)?.size ?? 0;
        if (size >= 2) {
          return ack({ ok: false });
        }
        socket.join(room);
        ack({ ok: true, isHost: size === 0 });
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

    socket.on("disconnect", () => {
      const remaining = (onlineCounts.get(email) ?? 1) - 1;
      if (remaining > 0) {
        onlineCounts.set(email, remaining);
        return;
      }
      onlineCounts.delete(email);
      io.emit("presence:offline", email);
    });
  });

  setIO(io);
  return io;
};
