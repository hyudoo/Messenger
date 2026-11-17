import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import {
  canDeleteConversation,
  canEditGroup,
  normalizeGroupName,
} from "@/app/libs/conversation-permissions";
import { deleteConversation } from "@/app/libs/conversation-delete";
import { emitGroupUpdate } from "@/app/libs/conversation-members";
import { postSystemMessage } from "@/app/libs/system-message";
import { emitToUser } from "@/app/libs/socket-server";
import { isUploadedFileUrl, markUploadsUsed } from "@/app/libs/s3";
import { cleanUpUploads } from "@/app/libs/upload-cleanup";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import prisma from "@/app/libs/prismadb";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;
// people added at once (the picker offers everyone, so this only stops abuse)
const MAX_ADD = 50;

// PATCH { name?, image?, addUserIds? }: renames a group, changes its photo (the caller's own upload,
// or null to remove it) and / or adds people to it (any member).
// The members get the new name / list (conversation:update); the people added get the
// conversation as their inbox shows it (conversation:new).
export async function PATCH(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { conversationId } = await params;
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser(conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canEditGroup(conversation)) {
      return new NextResponse("Only groups can be edited", { status: 400 });
    }

    const body = await request.json().catch(() => ({}));
    const name = body?.name === undefined ? undefined : normalizeGroupName(body.name);
    if (name === null) {
      return new NextResponse("Invalid name", { status: 400 });
    }
    const requested: unknown[] = Array.isArray(body?.addUserIds) ? body.addUserIds : [];
    const addIds = Array.from(
      new Set(
        requested.filter(
          (id): id is string =>
            typeof id === "string" && OBJECT_ID.test(id) && !conversation.userIds.includes(id)
        )
      )
    );
    // undefined: unchanged; null: removed; else the caller's own upload
    const image: string | null | undefined =
      body?.image === undefined || body.image === conversation.image ? undefined : body.image;
    if (image !== undefined && image !== null && !isUploadedFileUrl(image, currentUser.id)) {
      return new NextResponse("Invalid image", { status: 400 });
    }
    if (
      addIds.length > MAX_ADD ||
      (name === undefined && image === undefined && addIds.length === 0)
    ) {
      return new NextResponse("Invalid data", { status: 400 });
    }
    if (image) {
      // keeps the file from the pending-upload expiry; fails if it was never uploaded
      try {
        await markUploadsUsed([image]);
      } catch (error) {
        logError("mark_upload_used", error);
        return new NextResponse("Image not found", { status: 400 });
      }
    }
    if (addIds.length > 0) {
      const existing = await prisma.user.count({ where: { id: { in: addIds } } });
      if (existing !== addIds.length) {
        return new NextResponse("Invalid members", { status: 400 });
      }
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        ...(name !== undefined && { name }),
        ...(image !== undefined && { image }),
        ...(addIds.length > 0 && { users: { connect: addIds.map((id) => ({ id })) } }),
      },
      include: { users: true },
    });

    const added = updated.users.filter((user) => addIds.includes(user.id));
    emitGroupUpdate(
      updated,
      updated.users.filter((user) => !addIds.includes(user.id))
    );
    // the events go to everyone now in the group (the people added have no inbox item yet, so
    // theirs is ignored until conversation:new below)
    if (name !== undefined && name !== conversation.name) {
      await postSystemMessage({ conversation: updated, actorId: currentUser.id, type: "renamed", name });
    }
    if (image !== undefined) {
      // the replaced photo, if nothing else uses it
      cleanUpUploads([conversation.image]);
      // removing it needs no event: the group's avatar just goes back to its members'
      if (image) {
        await postSystemMessage({ conversation: updated, actorId: currentUser.id, type: "photo" });
      }
    }
    if (added.length > 0) {
      const event = await postSystemMessage({
        conversation: updated,
        actorId: currentUser.id,
        type: "added",
        users: added,
        seenBy: added.map((user) => user.id),
      });
      // their inbox item: the last message ("X added you"), nothing unread yet
      const messages = event ? [event] : [];
      added.forEach((user) => {
        if (user.email) {
          emitToUser(user.email, "conversation:new", { ...updated, messages, unreadCount: 0 });
        }
      });
    }

    return NextResponse.json(updated);
  } catch (error) {
    logError("conversation_update", error);
    return new NextResponse("Error", { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { conversationId } = await params;
    const currentUser = await getCurrentUser();

    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // only members may delete, and only then are the others notified
    const existingConversation = await getConversationForUser(
      conversationId,
      currentUser.id
    );
    if (!existingConversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    // a group is deleted for everyone, so only by its owner (the others leave it instead);
    // groups from before ownerId existed have no owner and any member may still delete them
    if (!canDeleteConversation(existingConversation, currentUser.id)) {
      return new NextResponse("Only the group owner can delete it", { status: 403 });
    }

    return NextResponse.json(await deleteConversation(existingConversation));
  } catch (error) {
    logError("conversation_delete", error);
    return new NextResponse("Error", { status: 500 });
  }
}
