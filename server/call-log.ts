import type { Server } from "socket.io";
import type { CallStatus, Prisma } from "@prisma/client";

import prisma from "../app/libs/prismadb";
import { MESSAGE_INCLUDE } from "../app/libs/message-include";
import { conversationRoom, userRoom } from "../app/libs/socket-rooms";

// The call message (the one /api/messages created with isCall, status "ringing") records how the
// call went. Only the socket server sees who joins and leaves the call room, so it moves the status:
//   ringing -> answered   the second peer joined (callAnsweredAt)
//   answered -> ended     either peer left (callEndedAt; duration = ended - answered)
//   ringing -> declined   the callee declined (1:1)
//   ringing -> missed     the caller hung up or gave up before an answer, or nobody is left
// Each move only applies from its expected status (an atomic updateMany on id + status), so events
// racing each other (the caller's no-answer timeout vs. the callee joining, two tabs declining) can't
// overwrite a later status. The call is the conversation's latest call message (room id == conversation id).

type AnyServer = Server<any, any, any, any>;

const MOVES = {
  answer: { from: "ringing", to: "answered", stamp: "callAnsweredAt" },
  end: { from: "answered", to: "ended", stamp: "callEndedAt" },
  decline: { from: "ringing", to: "declined", stamp: "callEndedAt" },
  miss: { from: "ringing", to: "missed", stamp: "callEndedAt" },
} as const satisfies Record<
  string,
  { from: CallStatus; to: CallStatus; stamp: "callAnsweredAt" | "callEndedAt" }
>;

export type CallMove = keyof typeof MOVES;

// Applies the move and tells the conversation (chat view) and, when the call is still the last
// message, the members' conversation lists. Returns whether the status changed.
export const moveCall = async (
  io: AnyServer,
  conversationId: string,
  move: CallMove
): Promise<boolean> => {
  const { from, to, stamp } = MOVES[move];

  const call = await prisma.message.findFirst({
    where: { conversationId, isCall: true },
    orderBy: { createdAt: "desc" },
    select: { id: true, callStatus: true },
  });
  if (!call || call.callStatus !== from) {
    return false;
  }

  const data: Prisma.MessageUpdateManyMutationInput = { callStatus: to, [stamp]: new Date() };
  const { count } = await prisma.message.updateMany({
    where: { id: call.id, callStatus: from },
    data,
  });
  if (count === 0) {
    return false;
  }

  const message = await prisma.message.findUnique({
    where: { id: call.id },
    include: MESSAGE_INCLUDE,
  });
  if (!message) {
    return true;
  }
  io.to(conversationRoom(conversationId)).emit("messages:update", message);

  // no lastMessageAt: the conversation keeps its place in the list
  const conversation = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: {
      users: { select: { email: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });
  if (conversation?.messages[0]?.id === message.id) {
    const rooms = conversation.users.flatMap((user) => (user.email ? [userRoom(user.email)] : []));
    if (rooms.length > 0) {
      io.to(rooms).emit("conversation:update", { id: conversationId, messages: [message] });
    }
  }
  return true;
};

// For handlers that must never throw (socket events, disconnects)
export const moveCallSafely = (io: AnyServer, conversationId: string, move: CallMove) =>
  moveCall(io, conversationId, move).catch((error) => {
    console.log(error, "ERROR_CALL_LOG");
    return false;
  });
