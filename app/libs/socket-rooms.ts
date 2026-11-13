// Socket.io room names, shared by the socket server (server/socket.ts) and route handlers.
export const userRoom = (email: string) => `user:${email}`;
export const conversationRoom = (conversationId: string) =>
  `conversation:${conversationId}`;
export const callRoom = (roomId: string) => `call:${roomId}`;
