import { io, Socket } from "socket.io-client";

let socket: Socket | null = null;

// One shared connection per tab. It is connected by useActiveChannel once the
// user is authenticated; emits made before that are buffered by socket.io.
export const getSocket = () => {
  if (!socket) {
    socket = io({ autoConnect: false, withCredentials: true });
  }
  return socket;
};

// Joins a conversation room and re-joins after reconnects (the server forgets
// room membership when a socket disconnects). Returns the cleanup function.
export const subscribeConversation = (conversationId: string) => {
  const s = getSocket();
  const join = () => s.emit("conversation:join", conversationId);

  if (s.connected) {
    join();
  }
  s.on("connect", join);

  return () => {
    s.off("connect", join);
    s.emit("conversation:leave", conversationId);
  };
};
