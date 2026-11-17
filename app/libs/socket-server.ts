import type { Server } from "socket.io";

import { conversationRoom, userRoom } from "./socket-rooms";

// The socket.io server is created by the custom server (server.ts) and shared
// with route handlers through globalThis, since both run in the same process.
declare global {
  var io: Server | undefined;
  // set by server/socket.ts: whether other instances share events (Redis adapter)
  var ioClustered: boolean | undefined;
  // email -> the emails hidden from them and them from (blocks; filled by server/socket.ts)
  var blockCache: Map<string, Promise<Set<string>>> | undefined;
}

// The presence / typing filter's cache, shared by the socket server and route handlers (one
// process, separate module copies).
export const blockCache = (): Map<string, Promise<Set<string>>> =>
  (globalThis.blockCache ??= new Map());

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

// After a block / unblock: forgets the cached block lists of these users here and on the other
// instances, and tells their tabs (block:update), which refresh the open chat and ask for the
// presence list again (presence:sync).
export const notifyBlocksChanged = (emails: string[]) => {
  emails.forEach((email) => blockCache().delete(email));
  const io = getIO();
  if (globalThis.ioClustered) {
    try {
      io?.serverSideEmit("blocks:changed", emails);
    } catch {
      // the others' caches catch up when those users reconnect
    }
  }
  emails.forEach((email) => emitToUser(email, "block:update", {}));
};
