import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { isUploadedFileUrl, markUploadsUsed } from "@/app/libs/s3";
import { emitToConversation, emitToUser } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { MESSAGE_INCLUDE, NOT_RECALLED, NOT_SYSTEM } from "@/app/libs/message-include";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { pushIncomingCall, pushNewMessage } from "@/app/libs/message-push";
import { parseAttachment } from "@/app/libs/attachment";

const MAX_MESSAGE_LENGTH = 5000;
// the sender's tab id for an optimistic message (app/hooks/useOutbox.ts); only echoed back
const CLIENT_ID = /^[\w-]{1,64}$/;
const OBJECT_ID = /^[a-f\d]{24}$/i;

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

    const { message, isCall, callType, image, attachment, conversationId, clientId, replyToId } =
      await request.json();

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
    // a file or voice message: the caller's own upload of that kind, on its own
    const file = attachment === undefined ? null : parseAttachment(attachment, currentUser.id);
    if (attachment !== undefined && (!file || image !== undefined || isCall)) {
      return new NextResponse("Invalid attachment", { status: 400 });
    }
    if (isCall === true && callType !== undefined && callType !== "audio" && callType !== "video") {
      return new NextResponse("Invalid call type", { status: 400 });
    }
    if (!body && !image && !file && !isCall) {
      return new NextResponse("Empty message", { status: 400 });
    }
    // a reply quotes a person's message of the same conversation that is still there
    if (replyToId !== undefined && replyToId !== null) {
      const original =
        typeof replyToId === "string" && OBJECT_ID.test(replyToId) && !isCall
          ? await prisma.message.findFirst({
              where: {
                id: replyToId,
                conversationId: conversation.id,
                AND: [NOT_RECALLED, NOT_SYSTEM],
              },
              select: { id: true },
            })
          : null;
      if (!original) {
        return new NextResponse("Invalid reply", { status: 400 });
      }
    }
    const uploaded = [image, file?.url].filter((url): url is string => !!url);
    if (uploaded.length > 0) {
      // keeps the files from the pending-upload expiry; fails if one was never uploaded
      try {
        await markUploadsUsed(uploaded);
      } catch (error) {
        logError("mark_upload_used", error);
        return new NextResponse("Image not found", { status: 400 });
      }
    }

    const newMessage = await prisma.message.create({
      include: MESSAGE_INCLUDE,
      data: {
        body: body || undefined,
        image,
        attachment: file ?? undefined,
        isCall: isCall === true ? true : undefined,
        // video unless asked for audio (older clients send no callType)
        callType: isCall === true ? (callType === "audio" ? "audio" : "video") : undefined,
        // the socket server moves it on from here (server/call-log.ts)
        callStatus: isCall === true ? "ringing" : undefined,
        conversationId: conversation.id,
        senderId: currentUser.id,
        seenIds: [currentUser.id],
        replyToId: replyToId || undefined,
      },
    });

    const { lastMessageAt } = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: newMessage.createdAt },
      select: { lastMessageAt: true },
    });

    // clientId lets the sending tab swap its optimistic copy for this message, whichever of the
    // socket event and the HTTP response arrives first
    emitToConversation(conversation.id, "messages:new", {
      ...newMessage,
      ...(typeof clientId === "string" && CLIENT_ID.test(clientId) && { clientId }),
    });

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
        // for the desktop notification's title (MessageNotifications)
        name: conversation.name,
        isGroup: conversation.isGroup,
      });
    });

    // Web Push to the others' browsers, for when their tabs are closed (in the background: it never
    // fails or holds up the send). A call's push lasts only while it rings; a missed call gets its
    // own (server/call-log.ts).
    const push = {
      conversation,
      sender: currentUser,
      recipientIds: conversation.users
        .map((user) => user.id)
        .filter((id) => id !== currentUser.id),
    };
    if (isCall === true) {
      void pushIncomingCall({
        ...push,
        callType: newMessage.callType,
        startedAt: newMessage.createdAt,
      });
    } else {
      void pushNewMessage({
        ...push,
        body: newMessage.body,
        image: newMessage.image,
        attachment: newMessage.attachment,
      });
    }

    return NextResponse.json(newMessage);
  } catch (error) {
    logError("messages", error);
    return new NextResponse("Error", { status: 500 });
  }
}
