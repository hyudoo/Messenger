import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { MAX_PINNED_MESSAGES, canPinMessage } from "@/app/libs/message-actions";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { emitToConversation } from "@/app/libs/socket-server";
import { postSystemMessage } from "@/app/libs/system-message";
import { logError } from "@/app/libs/log";

interface IParams {
  messageId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// POST { pinned }: pins a message to the top of its chat or unpins it (any member). The chat gets
// pins:update; pinning also posts a group event-style line ("X pinned a message").
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

    const { messageId } = await params;
    const { pinned } = await request.json().catch(() => ({}));
    if (typeof pinned !== "boolean") {
      return new NextResponse("Invalid data", { status: 400 });
    }
    const message =
      messageId && OBJECT_ID.test(messageId)
        ? await prisma.message.findUnique({ where: { id: messageId } })
        : null;
    const conversation =
      message && (await getConversationForUser(message.conversationId, currentUser.id));
    if (!message || !conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (pinned && !canPinMessage(message)) {
      return new NextResponse("This message can't be pinned", { status: 400 });
    }

    const current = conversation.pinnedMessageIds ?? [];
    const already = current.includes(message.id);
    if (pinned && !already && current.length >= MAX_PINNED_MESSAGES) {
      return new NextResponse("Too many pinned messages", { status: 409 });
    }
    const pinnedMessageIds = pinned
      ? [message.id, ...current.filter((id) => id !== message.id)]
      : current.filter((id) => id !== message.id);
    if (pinned === already) {
      return NextResponse.json({ conversationId: conversation.id, pinnedMessageIds: current });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { pinnedMessageIds },
      select: { id: true },
    });
    emitToConversation(conversation.id, "pins:update", {
      conversationId: conversation.id,
      pinnedMessageIds,
    });
    if (pinned) {
      await postSystemMessage({ conversation, actorId: currentUser.id, type: "pinned" });
    }
    return NextResponse.json({ conversationId: conversation.id, pinnedMessageIds });
  } catch (error) {
    logError("message_pin", error);
    return new NextResponse("Error", { status: 500 });
  }
}
