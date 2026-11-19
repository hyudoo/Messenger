import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { parseChatTheme, parseQuickEmoji } from "@/app/libs/chat-theme";
import { emitGroupUpdate } from "@/app/libs/conversation-members";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { postSystemMessage } from "@/app/libs/system-message";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// PATCH { themeColor?, quickEmoji? }: the conversation's color (a CHAT_THEMES key) and quick emoji
// (one emoji), each null for the default. Any member, 1:1 or group, for everyone in it. The members
// get them with the group update (the open chat refreshes) and a `theme` / `quick_emoji` event per
// change names who did it. Setting what is already set changes nothing.
export async function PATCH(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser((await params).conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const themeColor = body?.themeColor === undefined ? undefined : parseChatTheme(body.themeColor);
    const quickEmoji = body?.quickEmoji === undefined ? undefined : parseQuickEmoji(body.quickEmoji);
    if (
      (body?.themeColor !== undefined && themeColor === undefined) ||
      (body?.quickEmoji !== undefined && quickEmoji === undefined) ||
      (body?.themeColor === undefined && body?.quickEmoji === undefined)
    ) {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const themeChanged = themeColor !== undefined && themeColor !== (conversation.themeColor ?? null);
    const emojiChanged = quickEmoji !== undefined && quickEmoji !== (conversation.quickEmoji ?? null);
    if (!themeChanged && !emojiChanged) {
      return NextResponse.json({
        themeColor: conversation.themeColor ?? null,
        quickEmoji: conversation.quickEmoji ?? null,
      });
    }
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(themeChanged && { themeColor }),
        ...(emojiChanged && { quickEmoji }),
      },
      include: { users: true },
    });

    await emitGroupUpdate(updated, updated.users);
    if (themeChanged) {
      await postSystemMessage({ conversation: updated, actorId: currentUser.id, type: "theme", name: themeColor });
    }
    if (emojiChanged) {
      await postSystemMessage({
        conversation: updated,
        actorId: currentUser.id,
        type: "quick_emoji",
        name: quickEmoji,
      });
    }
    return NextResponse.json({ themeColor: updated.themeColor ?? null, quickEmoji: updated.quickEmoji ?? null });
  } catch (error) {
    logError("conversation_appearance", error);
    return new NextResponse("Error", { status: 500 });
  }
}
