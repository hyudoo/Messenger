import prisma from "@/app/libs/prismadb";
import getCurrentUser from "./getCurrentUser";

// The user's conversations, latest activity first, each with only its last message. Throws on a
// database error (GET /api/conversations answers 500 then, so the client keeps the list it has).
export const findConversationsForUser = (userId: string) =>
  prisma.conversation.findMany({
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
