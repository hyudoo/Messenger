import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { searchMessages, searchQueryOf } from "@/app/libs/message-search";

// GET ?q=: text messages containing q in all of the user's conversations (the inbox's search),
// newest first, each with the conversation it is in: its title as the inbox shows it (the group's
// name, else the other person's) and whether it is a group. Opening one goes to
// /conversations/<id>?message=<id>.
export async function GET(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("search", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const query = searchQueryOf(request);
    if (!query) {
      return new NextResponse("Invalid query", { status: 400 });
    }

    // the user's conversations, with what a result shows of them
    const conversations = await prisma.conversation.findMany({
      where: { userIds: { has: currentUser.id } },
      select: {
        id: true,
        name: true,
        isGroup: true,
        users: { select: { id: true, name: true } },
      },
    });
    const titles = new Map(
      conversations.map((conversation) => [
        conversation.id,
        {
          id: conversation.id,
          isGroup: !!conversation.isGroup,
          title:
            (conversation.isGroup && conversation.name) ||
            conversation.users.find((user) => user.id !== currentUser.id)?.name ||
            conversation.name ||
            "",
        },
      ])
    );

    const messages = await searchMessages(Array.from(titles.keys()), currentUser.id, query, {
      id: true,
      body: true,
      createdAt: true,
      conversationId: true,
      sender: { select: { name: true, email: true, image: true } },
    });
    return NextResponse.json(
      messages.map(({ conversationId, ...message }) => ({
        ...message,
        conversation: titles.get(conversationId as string),
      }))
    );
  } catch (error) {
    logError("message_search_all", error);
    return new NextResponse("Error", { status: 500 });
  }
}
