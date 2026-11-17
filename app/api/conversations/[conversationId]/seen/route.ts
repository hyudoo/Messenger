import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { emitToConversation, emitToUser } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const currentUser = await getCurrentUser();
    const { conversationId } = await params;

    if (!currentUser?.id || !currentUser?.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("seen", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser(
      conversationId,
      currentUser.id
    );
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    const lastMessage = await prisma.message.findFirst({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: "desc" },
      select: { id: true, seenIds: true },
    });

    // nothing to mark, or already seen by this user
    if (!lastMessage || lastMessage.seenIds.includes(currentUser.id)) {
      return new NextResponse("Success");
    }

    const updatedMessage = await prisma.message.update({
      where: {
        id: lastMessage.id,
      },
      include: MESSAGE_INCLUDE,
      data: {
        seen: {
          connect: {
            id: currentUser.id,
          },
        },
      },
    });

    // the user's own conversation list shows the message as seen
    emitToUser(currentUser.email, "conversation:update", {
      id: conversation.id,
      messages: [updatedMessage],
    });

    // other members see the "seen by" list update
    emitToConversation(conversation.id, "messages:update", updatedMessage);

    return new NextResponse("Success");
  } catch (error) {
    logError("messages_seen", error);
    return new NextResponse("Error", { status: 500 });
  }
}
