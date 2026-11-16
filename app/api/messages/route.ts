import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { isUploadedFileUrl, markUploadsUsed } from "@/app/libs/s3";
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

    const limited = await rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { message, isCall, callType, image, conversationId } = await request.json();

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
    // only the sender's own uploads
    if (image !== undefined && !isUploadedFileUrl(image, currentUser.id)) {
      return new NextResponse("Invalid image", { status: 400 });
    }
    if (isCall === true && callType !== undefined && callType !== "audio" && callType !== "video") {
      return new NextResponse("Invalid call type", { status: 400 });
    }
    if (!body && !image && !isCall) {
      return new NextResponse("Empty message", { status: 400 });
    }
    if (image) {
      // keeps the file from the pending-upload expiry; fails if it was never uploaded
      try {
        await markUploadsUsed([image]);
      } catch (error) {
        console.log(error, "ERROR_MARK_UPLOAD_USED");
        return new NextResponse("Image not found", { status: 400 });
      }
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
        // video unless asked for audio (older clients send no callType)
        callType: isCall === true ? (callType === "audio" ? "audio" : "video") : undefined,
        // the socket server moves it on from here (server/call-log.ts)
        callStatus: isCall === true ? "ringing" : undefined,
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
        emitToUser(user.email, "call:incoming", {
          id: conversation.id,
          user: currentUser,
          callType: newMessage.callType,
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
