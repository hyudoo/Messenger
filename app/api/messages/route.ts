import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { isUploadedFileUrl } from "@/app/libs/s3";
import { emitToConversation, emitToUser } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";

const MAX_MESSAGE_LENGTH = 5000;

export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser?.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { message, isCall, image, conversationId } = await request.json();

    const conversation = await getConversationForUser(
      conversationId,
      currentUser.id
    );
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    const body = typeof message === "string" ? message.trim() : "";
    if (body.length > MAX_MESSAGE_LENGTH) {
      return new NextResponse("Message too long", { status: 400 });
    }
    if (image !== undefined && !isUploadedFileUrl(image)) {
      return new NextResponse("Invalid image", { status: 400 });
    }
    if (!body && !image && !isCall) {
      return new NextResponse("Empty message", { status: 400 });
    }

    const newMessage = await prisma.message.create({
      include: {
        seen: true,
        sender: true,
      },
      data: {
        body: body || undefined,
        image,
        isCall: isCall === true ? true : undefined,
        conversationId: conversation.id,
        senderId: currentUser.id,
        seenIds: [currentUser.id],
      },
    });

    const { lastMessageAt } = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: newMessage.createdAt },
      select: { lastMessageAt: true },
    });

    emitToConversation(conversation.id, "messages:new", newMessage);

    conversation.users.forEach((user) => {
      if (!user.email) {
        return;
      }
      if (isCall === true && user.email !== currentUser.email) {
        emitToUser(user.email, "recive-call", {
          id: conversation.id,
          user: currentUser,
        });
      }
      // the new message is the conversation's last message
      emitToUser(user.email, "conversation:update", {
        id: conversation.id,
        lastMessageAt,
        messages: [newMessage],
      });
    });

    return NextResponse.json(newMessage);
  } catch (error) {
    console.log(error, "ERROR_MESSAGES");
    return new NextResponse("Error", { status: 500 });
  }
}
