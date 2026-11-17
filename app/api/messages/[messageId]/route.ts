import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { logError } from "@/app/libs/log";
import { canEditMessage, canRecallMessage } from "@/app/libs/message-actions";
import { searchTextOf } from "@/app/libs/search";
import { findMentions } from "@/app/libs/mentions";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { emitToConversation, emitToUser } from "@/app/libs/socket-server";
import { cleanUpUploads } from "@/app/libs/upload-cleanup";
import { ConversationWithUsers, FullMessageType } from "@/app/types";

interface IParams {
  messageId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;
const MAX_MESSAGE_LENGTH = 5000;

// The message and its conversation, for a member; null for "missing" and "not a member" alike.
const loadForMember = async (messageId: string | undefined, userId: string) => {
  if (!messageId || !OBJECT_ID.test(messageId)) {
    return null;
  }
  const message = await prisma.message.findUnique({ where: { id: messageId } });
  const conversation = message && (await getConversationForUser(message.conversationId, userId));
  return message && conversation ? { message, conversation } : null;
};

// The chat replaces the message (messages:update); when it is the conversation's last message the
// inbox preview changes too (conversation:update without lastMessageAt: no reordering, no unread).
const broadcast = async (conversation: ConversationWithUsers, updated: FullMessageType) => {
  emitToConversation(conversation.id, "messages:update", updated);
  const last = await prisma.message.findFirst({
    where: { conversationId: conversation.id },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    select: { id: true },
  });
  if (last?.id === updated.id) {
    conversation.users.forEach((user) => {
      if (user.email) {
        emitToUser(user.email, "conversation:update", {
          id: conversation.id,
          messages: [updated],
        });
      }
    });
  }
};

// PATCH { message }: the sender edits the text of their message (within EDIT_WINDOW_MS).
export async function PATCH(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const found = await loadForMember((await params).messageId, currentUser.id);
    if (!found) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canEditMessage(found.message, currentUser.id)) {
      return new NextResponse("This message can't be edited", { status: 403 });
    }

    const { message } = await request.json().catch(() => ({}));
    const body = typeof message === "string" ? message.trim() : "";
    if (!body || body.length > MAX_MESSAGE_LENGTH) {
      return new NextResponse("Invalid message", { status: 400 });
    }
    if (body === found.message.body) {
      return new NextResponse("Unchanged", { status: 400 });
    }

    const updated = await prisma.message.update({
      where: { id: found.message.id },
      data: {
        body,
        searchText: searchTextOf(body),
        // names added by the edit are highlighted, but nobody is notified again
        mentions: found.conversation.isGroup
          ? findMentions(body, found.conversation.users, currentUser.id)
          : [],
        editedAt: new Date(),
      },
      include: MESSAGE_INCLUDE,
    });
    await broadcast(found.conversation, updated);
    return NextResponse.json(updated);
  } catch (error) {
    logError("message_edit", error);
    return new NextResponse("Error", { status: 500 });
  }
}

// DELETE: the sender recalls their message for everyone. The row stays (replies keep a target,
// the chat shows "message recalled"); its text, image, attachment and reactions are removed.
export async function DELETE(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const found = await loadForMember((await params).messageId, currentUser.id);
    if (!found) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canRecallMessage(found.message, currentUser.id)) {
      return new NextResponse("This message can't be recalled", { status: 403 });
    }

    const [, updated] = await prisma.$transaction([
      prisma.reaction.deleteMany({ where: { messageId: found.message.id } }),
      prisma.message.update({
        where: { id: found.message.id },
        data: {
          body: null,
          searchText: null,
          image: null,
          attachment: { unset: true },
          editedAt: null,
          deletedAt: new Date(),
        },
        include: MESSAGE_INCLUDE,
      }),
    ]);

    // the files go from S3 once nothing references them (e.g. an image that is also an avatar)
    cleanUpUploads([found.message.image, found.message.attachment?.url]);
    await broadcast(found.conversation, updated);
    return NextResponse.json(updated);
  } catch (error) {
    logError("message_recall", error);
    return new NextResponse("Error", { status: 500 });
  }
}
