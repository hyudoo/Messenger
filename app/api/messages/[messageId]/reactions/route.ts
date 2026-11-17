import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { countEmojiOnly } from "@/app/libs/emoji";
import { canReactToMessage } from "@/app/libs/message-actions";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { emitToConversation } from "@/app/libs/socket-server";
import { logError } from "@/app/libs/log";

interface IParams {
  messageId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;
// a single emoji, even a long ZWJ sequence such as a family with skin tones
const MAX_EMOJI_LENGTH = 32;

// POST { emoji }: toggles the caller's reaction. The same emoji again removes it,
// another emoji replaces it (one reaction per user per message). Members only;
// the updated message goes to the conversation as messages:update.
export async function POST(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("reaction", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { messageId } = await params;
    if (!messageId || !OBJECT_ID.test(messageId)) {
      return new NextResponse("Not found", { status: 404 });
    }

    const { emoji: rawEmoji } = await request.json().catch(() => ({}));
    const emoji = typeof rawEmoji === "string" ? rawEmoji.trim() : "";
    if (emoji.length > MAX_EMOJI_LENGTH || countEmojiOnly(emoji) !== 1) {
      return new NextResponse("Invalid emoji", { status: 400 });
    }

    // "missing" and "not a member" look the same
    const message = await prisma.message.findUnique({
      where: { id: messageId },
      select: { conversationId: true, deletedAt: true, isCall: true, systemType: true },
    });
    const conversation =
      message && (await getConversationForUser(message.conversationId, currentUser.id));
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    // a recalled message has nothing left to react to; calls and group events aren't for reacting
    if (!canReactToMessage(message)) {
      return new NextResponse("Cannot react to this message", { status: 400 });
    }

    const key = { messageId_userId: { messageId, userId: currentUser.id } };
    const existing = await prisma.reaction.findUnique({ where: key });
    if (existing?.emoji === emoji) {
      // already gone (a double click) is fine
      await prisma.reaction.deleteMany({ where: { id: existing.id } });
    } else {
      await prisma.reaction.upsert({
        where: key,
        create: { emoji, messageId, userId: currentUser.id },
        update: { emoji },
      });
    }

    const updated = await prisma.message.findUnique({
      where: { id: messageId },
      include: MESSAGE_INCLUDE,
    });
    if (!updated) {
      return new NextResponse("Not found", { status: 404 });
    }
    emitToConversation(conversation.id, "messages:update", updated);

    return NextResponse.json(updated);
  } catch (error) {
    logError("reaction", error);
    return new NextResponse("Error", { status: 500 });
  }
}
