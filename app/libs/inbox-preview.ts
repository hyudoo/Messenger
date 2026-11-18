import prisma from "@/app/libs/prismadb";

// The inbox preview of a conversation for one user: its newest message the user hasn't deleted
// for themselves (Message.hiddenForIds), with what ConversationBox shows. null when every message
// is hidden for them (or there are none).
// Hidden ids are looked up with a positive `has`, then left out by id: `NOT: { has }` would also
// drop every message without the list (Prisma stores no empty lists on MongoDB).
export const lastVisibleMessage = async (conversationId: string, userId: string) => {
  const hidden = await prisma.message.findMany({
    where: { conversationId, hiddenForIds: { has: userId } },
    select: { id: true },
  });
  return prisma.message.findFirst({
    where: {
      conversationId,
      ...(hidden.length > 0 && { id: { notIn: hidden.map((message) => message.id) } }),
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    include: { sender: true, seen: true },
  });
};

// Of these message ids, the ones `userId` deleted for themselves.
export const hiddenAmong = async (messageIds: string[], userId: string) => {
  if (messageIds.length === 0) {
    return new Set<string>();
  }
  const hidden = await prisma.message.findMany({
    where: { id: { in: messageIds }, hiddenForIds: { has: userId } },
    select: { id: true },
  });
  return new Set(hidden.map((message) => message.id));
};
