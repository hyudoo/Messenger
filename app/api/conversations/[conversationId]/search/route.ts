import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { hiddenMessageIds } from "@/app/actions/getMessages";
import { NOT_RECALLED, NOT_SYSTEM } from "@/app/libs/message-include";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { normalizeSearch } from "@/app/libs/search";

interface IParams {
  conversationId?: string;
}

const MAX_QUERY_LENGTH = 100;
const MAX_RESULTS = 30;

// GET ?q=: the conversation's text messages containing q, ignoring case and Vietnamese
// diacritics (Message.searchText), newest first. Messages from before searchText (not backfilled
// yet) are matched on the body, case-insensitive only. Recalled messages and group events are
// left out. Members only.
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

    const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
    if (!query || query.length > MAX_QUERY_LENGTH) {
      return new NextResponse("Invalid query", { status: 400 });
    }

    // not the ones the user deleted for themselves (see hiddenMessageIds for why not `NOT has`)
    const hidden = await hiddenMessageIds(conversation.id, currentUser.id);
    const messages = await prisma.message.findMany({
      where: {
        conversationId: conversation.id,
        ...(hidden.length > 0 && { id: { notIn: hidden } }),
        AND: [
          NOT_RECALLED,
          NOT_SYSTEM,
          {
            OR: [
              { searchText: { contains: normalizeSearch(query) } },
              {
                searchText: { isSet: false },
                body: { contains: query, mode: "insensitive" },
              },
            ],
          },
        ],
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: MAX_RESULTS,
      select: {
        id: true,
        body: true,
        createdAt: true,
        sender: { select: { name: true, email: true, image: true } },
      },
    });
    return NextResponse.json(messages);
  } catch (error) {
    logError("message_search", error);
    return new NextResponse("Error", { status: 500 });
  }
}
