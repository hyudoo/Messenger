import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { searchMessages, searchQueryOf } from "@/app/libs/message-search";

interface IParams {
  conversationId?: string;
}

// GET ?q=: the conversation's text messages containing q (searchMessages), newest first.
// Members only.
export async function GET(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("search", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser((await params).conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    const query = searchQueryOf(request);
    if (!query) {
      return new NextResponse("Invalid query", { status: 400 });
    }

    const messages = await searchMessages([conversation.id], currentUser.id, query, {
      id: true,
      body: true,
      createdAt: true,
      sender: { select: { name: true, email: true, image: true } },
    });
    return NextResponse.json(messages);
  } catch (error) {
    logError("message_search", error);
    return new NextResponse("Error", { status: 500 });
  }
}
