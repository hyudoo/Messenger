import getConversationForUser from "@/app/actions/getConversationForUser";
import { MESSAGE_INCLUDE } from "./message-include";
import prisma from "./prismadb";
import { emitToConversation } from "./socket-server";

const OBJECT_ID = /^[a-f\d]{24}$/i;

// A poll with its message and conversation, for a member; null for "missing" and "not a member"
// alike (and for the poll of a recalled message).
export const loadPollForMember = async (pollId: string | undefined, userId: string) => {
  if (!pollId || !OBJECT_ID.test(pollId)) {
    return null;
  }
  const poll = await prisma.poll.findUnique({
    where: { id: pollId },
    select: {
      id: true,
      options: true,
      multiple: true,
      closedAt: true,
      message: { select: { id: true, conversationId: true, senderId: true, deletedAt: true } },
    },
  });
  if (!poll || poll.message.deletedAt) {
    return null;
  }
  const conversation = await getConversationForUser(poll.message.conversationId, userId);
  return conversation ? { poll, conversation } : null;
};

// The chat gets the poll's message again with the new votes / closed state (messages:update
// replaces the whole message, so it goes out with MESSAGE_INCLUDE).
export const emitPollUpdate = async (messageId: string, conversationId: string) => {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    include: MESSAGE_INCLUDE,
  });
  if (message) {
    emitToConversation(conversationId, "messages:update", message);
  }
  return message;
};
