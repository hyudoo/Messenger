import type { Server } from "socket.io";

import { ACTIVITY_HIDDEN_ROOM, conversationRoom, userRoom } from "./socket-rooms";

// The socket.io server is created by the custom server (server.ts) and shared
// with route handlers through globalThis, since both run in the same process.
declare global {
  var io: Server | undefined;
  // set by server/socket.ts: whether other instances share events (Redis adapter)
  var ioClustered: boolean | undefined;
  // email -> the emails hidden from them and them from (blocks; filled by server/socket.ts)
  var blockCache: Map<string, Promise<Set<string>>> | undefined;
  // email -> whether they hide their activity (User.hideActivity; filled by server/socket.ts)
  var activityCache: Map<string, Promise<boolean>> | undefined;
  // set by server/socket.ts: re-announces a user's presence after a privacy change, here
  var onActivityPrivacyChanged: ((email: string) => void) | undefined;
}

export const activityCache = (): Map<string, Promise<boolean>> =>
  (globalThis.activityCache ??= new Map());

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

// After the user turned "hide activity" on / off: their sockets (every instance) join / leave the
// room left out of presence events, every instance forgets the cached setting and announces them
// offline / online again ("privacy:changed"), and their tabs refresh and ask for the presence list
// again (block:update, as after a block).
export const notifyActivityPrivacyChanged = (email: string, hidden: boolean) => {
  activityCache().delete(email);
  const io = getIO();
  if (hidden) {
    io?.in(userRoom(email)).socketsJoin(ACTIVITY_HIDDEN_ROOM);
  } else {
    io?.in(userRoom(email)).socketsLeave(ACTIVITY_HIDDEN_ROOM);
  }
  if (globalThis.ioClustered) {
    try {
      io?.serverSideEmit("privacy:changed", email);
    } catch {
      // the others catch up when the user reconnects
    }
  }
  globalThis.onActivityPrivacyChanged?.(email);
  emitToUser(email, "block:update", {});
};
