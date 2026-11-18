import prisma from "@/app/libs/prismadb";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";
import { logError } from "@/app/libs/log";

export const MESSAGE_PAGE_SIZE = 50;

// The messages of a conversation the viewer deleted for themselves (Message.hiddenForIds).
// Looked up first and left out by id: Prisma writes no empty lists on MongoDB, so most messages
// have no hiddenForIds at all, and `NOT: { hiddenForIds: { has } }` leaves those out too (every
// message!). A positive `has` only matches documents that have the field, which is right.
export const hiddenMessageIds = async (conversationId: string, viewerId?: string) => {
  if (!viewerId) {
    return [];
  }
  const hidden = await prisma.message.findMany({
    where: { conversationId, hiddenForIds: { has: viewerId } },
    select: { id: true },
  });
  return hidden.map((message) => message.id);
};

// what `viewerId` sees of a conversation: not the messages they deleted for themselves
const visibleTo = async (conversationId: string, viewerId?: string) => {
  const hidden = await hiddenMessageIds(conversationId, viewerId);
  return { conversationId, ...(hidden.length > 0 && { id: { notIn: hidden } }) };
};

// One page of a conversation's messages, oldest first: the latest page, or the
// page just before message `before`. Callers must check membership first.
const getMessages = async (conversationId: string, before?: string, viewerId?: string) => {
  try {
    const page = await prisma.message.findMany({
      where: await visibleTo(conversationId, viewerId),
      include: MESSAGE_INCLUDE,
      // newest first so `take` keeps the latest; id breaks createdAt ties
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MESSAGE_PAGE_SIZE + 1,
      ...(before && { cursor: { id: before }, skip: 1 }),
    });

    return {
      messages: page.slice(0, MESSAGE_PAGE_SIZE).reverse(),
      hasMore: page.length > MESSAGE_PAGE_SIZE,
    };
  } catch (error) {
    // an empty chat rather than an error page, but never silently
    logError("get_messages", error);
    return { messages: [], hasMore: false };
  }
};

export default getMessages;

// The messages newer than message `after`, oldest first, at most one page; `hasMore` means more
// than a page arrived since (the client then reloads the latest page instead). Used to catch up
// after a socket reconnect. Throws on a database error. Callers must check membership first.
export const getMessagesAfter = async (conversationId: string, after: string, viewerId?: string) => {
  const page = await prisma.message.findMany({
    where: await visibleTo(conversationId, viewerId),
    include: MESSAGE_INCLUDE,
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    take: MESSAGE_PAGE_SIZE + 1,
    cursor: { id: after },
    skip: 1,
  });
  return {
    messages: page.slice(0, MESSAGE_PAGE_SIZE),
    hasMore: page.length > MESSAGE_PAGE_SIZE,
  };
};
