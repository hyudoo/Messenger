import type { Server } from "socket.io";
import type { CallStatus, Prisma } from "@prisma/client";

import prisma from "../app/libs/prismadb";
import { MESSAGE_INCLUDE } from "../app/libs/message-include";
import { conversationRoom, userRoom } from "../app/libs/socket-rooms";
import { logError } from "../app/libs/log";
import { pushMissedCall } from "../app/libs/message-push";

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
      id: true,
      name: true,
      isGroup: true,
      users: { select: { id: true, email: true } },
      messages: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } },
    },
  });

  // "Missed call" for the ones who were called (also replaces their ringing notification);
  // in the background, it never throws
  if (to === "missed" && conversation && message.sender) {
    void pushMissedCall({
      conversation,
      sender: message.sender,
      callType: message.callType,
      recipientIds: conversation.users
        .map((user) => user.id)
        .filter((id) => id !== message.senderId),
    });
  }
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
    logError("call_log", error);
    return false;
  });

// The callee declined a ringing call (the socket's call:decline, or the "Decline" button of the
// call's push notification through POST /api/calls/[id]/decline). 1:1: logged as declined, and every
// member's tabs hear it (the caller's call screen leaves, the callee's other tabs stop ringing).
// Group: the others may still answer, so only the decliner's own tabs hear it. Returns false when
// the user isn't a member.
export const declineCall = async (
  io: AnyServer,
  conversationId: string,
  user: { id: string; email: string }
): Promise<boolean> => {
  const conversation = await prisma.conversation
    .findFirst({
      where: { id: conversationId, userIds: { has: user.id } },
      select: { isGroup: true, users: { select: { email: true } } },
    })
    .catch(() => null); // malformed ObjectId
  if (!conversation) {
    return false;
  }
  // logged before call:declined goes out: the caller's call screen leaves on it, and that leave
  // must find the call already declined (not still ringing, which would log it as missed)
  if (!conversation.isGroup) {
    await moveCallSafely(io, conversationId, "decline");
  }
  const emails = conversation.isGroup
    ? [user.email]
    : conversation.users.flatMap((member) => (member.email ? [member.email] : []));
  io.to(emails.map(userRoom)).emit("call:declined", { roomId: conversationId, by: user.email });
  return true;
};
