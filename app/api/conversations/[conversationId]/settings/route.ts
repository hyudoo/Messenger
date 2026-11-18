import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { emitToUser } from "@/app/libs/socket-server";
import { MAX_PINNED } from "@/app/libs/conversation-permissions";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

const toggle = (ids: string[], id: string, on: boolean) =>
  on ? Array.from(new Set([...ids, id])) : ids.filter((item) => item !== id);

// PATCH { muted?, pinned?, archived? }: the user's own settings for a conversation they are in.
// Muted: no push or in-tab notification for its messages, left out of the unread total. Pinned:
// kept at the top of the inbox (at most MAX_PINNED). Archived: out of the inbox list (under
// "Archived", out of the unread total) until a new message arrives (app/libs/archive.ts). The
// user's other tabs get conversation:settings.
export async function PATCH(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("settings", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser((await params).conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    const { muted, pinned, archived } = await request.json().catch(() => ({}));
    if (
      (muted !== undefined && typeof muted !== "boolean") ||
      (pinned !== undefined && typeof pinned !== "boolean") ||
      (archived !== undefined && typeof archived !== "boolean") ||
      (muted === undefined && pinned === undefined && archived === undefined)
    ) {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const own = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      select: { mutedConversationIds: true, pinnedConversationIds: true, archivedConversationIds: true },
    });
    const mutedIds =
      muted === undefined ? own.mutedConversationIds : toggle(own.mutedConversationIds, conversation.id, muted);
    const pinnedIds =
      pinned === undefined ? own.pinnedConversationIds : toggle(own.pinnedConversationIds, conversation.id, pinned);
    const archivedIds =
      archived === undefined
        ? own.archivedConversationIds
        : toggle(own.archivedConversationIds, conversation.id, archived);
    if (pinned === true && pinnedIds.length > MAX_PINNED && !own.pinnedConversationIds.includes(conversation.id)) {
      return new NextResponse("Too many pinned conversations", { status: 409 });
    }

    await prisma.user.update({
      where: { id: currentUser.id },
      data: {
        mutedConversationIds: mutedIds,
        pinnedConversationIds: pinnedIds,
        archivedConversationIds: archivedIds,
      },
      select: { id: true },
    });

    const settings = {
      id: conversation.id,
      muted: mutedIds.includes(conversation.id),
      pinned: pinnedIds.includes(conversation.id),
      archived: archivedIds.includes(conversation.id),
    };
    emitToUser(currentUser.email, "conversation:settings", settings);
    return NextResponse.json(settings);
  } catch (error) {
    logError("conversation_settings", error);
    return new NextResponse("Error", { status: 500 });
  }
}
