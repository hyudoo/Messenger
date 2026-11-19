import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { isUploadedFileUrl, markUploadsUsed } from "@/app/libs/s3";
import prisma from "@/app/libs/prismadb";
import { MESSAGE_INCLUDE, NOT_RECALLED, NOT_SYSTEM } from "@/app/libs/message-include";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { deliverMessage } from "@/app/libs/message-delivery";
import { parseAttachment } from "@/app/libs/attachment";
import { findGiphy, giphyEnabled, isGifId, isGifKind } from "@/app/libs/giphy";
import { searchTextOf } from "@/app/libs/search";
import { findMentions } from "@/app/libs/mentions";
import { isBlockedBetween } from "@/app/libs/blocks";
import { attachLinkPreview } from "@/app/libs/message-preview";
import { callRoomSize } from "@/app/libs/socket-server";

const MAX_MESSAGE_LENGTH = 5000;
const OBJECT_ID = /^[a-f\d]{24}$/i;

// The call already going on in the conversation: its call message, while it rings or runs and
// somebody is in its call room. Calling then joins it (a group call one joins late, or a 1:1 call
// both start at once) instead of ringing everyone again with a new call message, which would also
// leave the running call's log (the latest call message, server/call-log.ts) behind.
const ongoingCall = async (conversationId: string) => {
  if ((await callRoomSize(conversationId)) === 0) {
    return null;
  }
  const call = await prisma.message.findFirst({
    where: { conversationId, isCall: true },
    orderBy: { createdAt: "desc" },
    include: MESSAGE_INCLUDE,
  });
  return call && (call.callStatus === "ringing" || call.callStatus === "answered") ? call : null;
};

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

    const { message, isCall, callType, image, attachment, gif, conversationId, clientId, replyToId } =
      await request.json();

    const conversation = await getConversationForUser(
      conversationId,
      currentUser.id
    );
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    // a 1:1 chat where either has blocked the other: no messages, no calls
    const other = conversation.isGroup
      ? null
      : conversation.users.find((user) => user.id !== currentUser.id);
    if (other && (await isBlockedBetween(currentUser.id, other.id))) {
      return new NextResponse("Blocked", { status: 403 });
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
    // a GIPHY GIF / sticker, by id only (looked up below), on its own
    if (
      gif !== undefined &&
      (!isGifId(gif?.id) || !isGifKind(gif?.kind) || body || image !== undefined || file || isCall)
    ) {
      return new NextResponse("Invalid GIF", { status: 400 });
    }
    if (isCall === true && callType !== undefined && callType !== "audio" && callType !== "video") {
      return new NextResponse("Invalid call type", { status: 400 });
    }
    if (!body && !image && !file && !isCall && gif === undefined) {
      return new NextResponse("Empty message", { status: 400 });
    }
    if (isCall === true) {
      const ongoing = await ongoingCall(conversation.id);
      if (ongoing) {
        return NextResponse.json({ ...ongoing, joined: true });
      }
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
    const gifData = gif === undefined ? null : giphyEnabled() ? await findGiphy(gif.id, gif.kind) : null;
    if (gif !== undefined && !gifData) {
      return new NextResponse("GIF not found", { status: 400 });
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
        searchText: searchTextOf(body),
        // only groups have mentions (in a 1:1 chat the other one gets everything anyway)
        mentions: conversation.isGroup ? findMentions(body, conversation.users, currentUser.id) : [],
        image,
        attachment: file ?? undefined,
        gif: gifData ?? undefined,
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

    await deliverMessage({ conversation, sender: currentUser, message: newMessage, clientId });
    attachLinkPreview(newMessage);

    return NextResponse.json(newMessage);
  } catch (error) {
    logError("messages", error);
    return new NextResponse("Error", { status: 500 });
  }
}
