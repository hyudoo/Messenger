import type { Server } from "socket.io";

import { conversationRoom, userRoom } from "./socket-rooms";

// The socket.io server is created by the custom server (server.ts) and shared
// with route handlers through globalThis, since both run in the same process.
declare global {
  var io: Server | undefined;
}

export const setIO = (server: Server) => {
  globalThis.io = server;
};

const getIO = () => {
  if (!globalThis.io) {
    console.warn("socket.io server is not running; start the app with server.ts");
  }
  return globalThis.io;
};

export const emitToUser = (email: string, event: string, payload: unknown) => {
  getIO()?.to(userRoom(email)).emit(event, payload);
};

export const emitToConversation = (
  conversationId: string,
  event: string,
  payload: unknown
) => {
  getIO()?.to(conversationRoom(conversationId)).emit(event, payload);
};

// Takes every socket of the user (all tabs, every instance with the Redis adapter) out of the
// conversation room, so someone who left a group or lost a deleted conversation stops receiving it.
export const removeUserFromConversationRoom = (email: string, conversationId: string) => {
  getIO()?.in(userRoom(email)).socketsLeave(conversationRoom(conversationId));
};
