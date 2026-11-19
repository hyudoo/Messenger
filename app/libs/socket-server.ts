import type { Server } from "socket.io";

import { ACTIVITY_HIDDEN_ROOM, callRoom, conversationRoom, userRoom } from "./socket-rooms";

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
  // email -> the emails whose presence they see and who see theirs: friends and the people they
  // share a conversation with (filled by server/socket.ts contactsOf)
  var contactCache: Map<string, { at: number; contacts: Promise<Set<string>> }> | undefined;
  // set by server/socket.ts: re-announces a user's presence after a privacy change, here
  var onActivityPrivacyChanged: ((email: string) => void) | undefined;
}

export const activityCache = (): Map<string, Promise<boolean>> =>
  (globalThis.activityCache ??= new Map());

// The presence / typing filter's cache, shared by the socket server and route handlers (one
// process, separate module copies).
export const blockCache = (): Map<string, Promise<Set<string>>> =>
  (globalThis.blockCache ??= new Map());

export const contactCache = (): Map<string, { at: number; contacts: Promise<Set<string>> }> =>
  (globalThis.contactCache ??= new Map());

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

// How many sockets are in the conversation's call room right now (every instance with Redis): a
// call is going on when it is not 0. 0 without a socket server.
export const callRoomSize = async (conversationId: string): Promise<number> => {
  const sockets = await getIO()?.in(callRoom(conversationId)).fetchSockets();
  return sockets?.length ?? 0;
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

// After who is in whose presence changed for these users (friends added / removed, a conversation
// created, people joining or leaving one): forgets their cached contacts here and on the other
// instances ("contacts:changed"), and tells their tabs (contacts:update), which ask for the
// presence list again (presence:sync) and, with `friends`, reload the contacts page.
export const notifyContactsChanged = (emails: (string | null | undefined)[], friends = false) => {
  const list = Array.from(new Set(emails.filter((email): email is string => !!email)));
  if (list.length === 0) {
    return;
  }
  list.forEach((email) => contactCache().delete(email));
  const io = getIO();
  if (globalThis.ioClustered) {
    try {
      io?.serverSideEmit("contacts:changed", list);
    } catch {
      // the others' caches expire on their own (CONTACTS_TTL_MS)
    }
  }
  list.forEach((email) => emitToUser(email, "contacts:update", { friends }));
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

// Closes the transport of this user's sockets on this instance: each client reconnects on its own
// and the auth middleware checks its session cookie again (refused once the session was revoked).
export const closeLocalUserSockets = (io: Server, email: string) => {
  const ids = io.sockets.adapter.rooms.get(userRoom(email));
  Array.from(ids ?? []).forEach((id) => io.sockets.sockets.get(id)?.conn.close());
};

// After the user's sessions were revoked (app/libs/sessions.ts): every instance forgets the cached
// session version ("sessions:revoked") and drops the user's sockets, so devices signed out reconnect
// into a refusal. The device that asked has its new cookie by the time its socket reconnects.
export const notifySessionsRevoked = (userId: string, email: string) => {
  const io = getIO();
  if (!io) {
    return;
  }
  if (globalThis.ioClustered) {
    try {
      io.serverSideEmit("sessions:revoked", { userId, email });
    } catch {
      // the others' caches expire on their own; their sockets close when their tokens expire
    }
  }
  closeLocalUserSockets(io, email);
};
