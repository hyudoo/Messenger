import prisma from "@/app/libs/prismadb";
import { UNREAD_SCAN_LIMIT, countUnread } from "@/app/libs/unread";
import getCurrentUser from "./getCurrentUser";

// Unread count of one conversation: scans its newest messages (index conversationId + createdAt)
// back to the user's read marker, at most UNREAD_SCAN_LIMIT of them.
const unreadIn = async (conversationId: string, userId: string) =>
  countUnread(
    await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: UNREAD_SCAN_LIMIT,
      select: { senderId: true, seenIds: true },
    }),
    userId
  );

// The user's conversations, latest activity first, each with only its last message and the
// number of messages the user hasn't seen. Throws on a database error (GET /api/conversations
// answers 500 then, so the client keeps the list it has).
export const findConversationsForUser = async (userId: string) => {
  const conversations = await prisma.conversation.findMany({
    orderBy: {
      lastMessageAt: "desc",
    },
    where: {
      userIds: {
        has: userId,
      },
    },
    include: {
      users: true,
      // the list only shows the last message
      messages: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        include: {
          sender: true,
          seen: true,
        },
      },
    },
  });

  // only conversations whose last message is unread need a scan (usually few)
  return Promise.all(
    conversations.map(async (conversation) => {
      const last = conversation.messages[0];
      const unread =
        last && last.senderId !== userId && !last.seenIds.includes(userId)
          ? await unreadIn(conversation.id, userId)
          : 0;
      return { ...conversation, unreadCount: unread };
    })
  );
};

const getConversations = async () => {
  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    return [];
  }

  try {
    return await findConversationsForUser(currentUser.id);
  } catch (error: any) {
    return [];
  }
};
export default getConversations;
