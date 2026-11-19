import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { deliverMessage } from "@/app/libs/message-delivery";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";
import { parseNewPoll } from "@/app/libs/poll-rules";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { searchTextOf } from "@/app/libs/search";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// POST { question, options, multiple? }: a member posts a poll in a group (parseNewPoll: 2–10
// distinct options). It is a message whose body is the question (search, the inbox preview and
// notifications work as for text) with its Poll, delivered like any message.
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser((await params).conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!conversation.isGroup) {
      return new NextResponse("Polls are for groups", { status: 400 });
    }
    const poll = parseNewPoll(await request.json().catch(() => null));
    if (!poll) {
      return new NextResponse("Invalid poll", { status: 400 });
    }

    const message = await prisma.message.create({
      include: MESSAGE_INCLUDE,
      data: {
        body: poll.question,
        searchText: searchTextOf(poll.question),
        conversationId: conversation.id,
        senderId: currentUser.id,
        seenIds: [currentUser.id],
        poll: {
          create: {
            question: poll.question,
            multiple: poll.multiple,
            // short random ids: the votes point at them
            options: poll.options.map((text) => ({ id: randomBytes(6).toString("base64url"), text })),
          },
        },
      },
    });

    await deliverMessage({ conversation, sender: currentUser, message });
    return NextResponse.json(message);
  } catch (error) {
    logError("poll_create", error);
    return new NextResponse("Error", { status: 500 });
  }
}
