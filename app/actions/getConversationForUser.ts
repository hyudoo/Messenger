import prisma from "@/app/libs/prismadb";

// Loads a conversation only if `userId` is one of its members, so callers can
// treat "not found" and "not yours" the same way. Malformed ids yield null.
const getConversationForUser = async (conversationId: unknown, userId: string) => {
  if (typeof conversationId !== "string") {
    return null;
  }
  try {
    return await prisma.conversation.findFirst({
      where: { id: conversationId, userIds: { has: userId } },
      include: { users: true },
    });
  } catch {
    return null;
  }
};

export default getConversationForUser;
