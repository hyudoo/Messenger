import prisma from "@/app/libs/prismadb";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";

export const MESSAGE_PAGE_SIZE = 50;

// One page of a conversation's messages, oldest first: the latest page, or the
// page just before message `before`. Callers must check membership first.
const getMessages = async (conversationId: string, before?: string) => {
  try {
    const page = await prisma.message.findMany({
      where: {
        conversationId: conversationId,
      },
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
  } catch (error: any) {
    return { messages: [], hasMore: false };
  }
};

export default getMessages;
