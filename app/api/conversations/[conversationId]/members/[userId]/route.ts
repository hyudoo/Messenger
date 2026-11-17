import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import {
  MAX_ADMINS,
  canManageAdmins,
  canRemoveMember,
} from "@/app/libs/conversation-permissions";
import { emitGroupUpdate, removeGroupMember } from "@/app/libs/conversation-members";
import { postSystemMessage } from "@/app/libs/system-message";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
  userId?: string;
}

// PATCH { admin }: the owner makes a member an admin or takes it back. The members get the new
// admin list (conversation:update) and a group event.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { conversationId, userId } = await params;
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const body = await request.json().catch(() => ({}));
    if (typeof body?.admin !== "boolean") {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const conversation = await getConversationForUser(conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    const member = conversation.users.find((user) => user.id === userId);
    if (!userId || !member) {
      return new NextResponse("Not a member", { status: 404 });
    }
    if (!canManageAdmins(conversation, currentUser.id, userId)) {
      return new NextResponse("Only the group owner can change admins", { status: 403 });
    }

    const current = conversation.adminIds ?? [];
    if (current.includes(userId) === body.admin) {
      return NextResponse.json({ adminIds: current });
    }
    if (body.admin && current.length >= MAX_ADMINS) {
      return new NextResponse("Too many admins", { status: 409 });
    }
    const adminIds = body.admin
      ? [...current, userId]
      : current.filter((id) => id !== userId);

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { adminIds: { set: adminIds } },
      include: { users: true },
    });
    emitGroupUpdate(updated, updated.users);
    await postSystemMessage({
      conversation: updated,
      actorId: currentUser.id,
      type: body.admin ? "promoted" : "demoted",
      users: [member],
    });
    return NextResponse.json({ adminIds });
  } catch (error) {
    logError("conversation_admin", error);
    return new NextResponse("Error", { status: 500 });
  }
}

// Removes another member from a group (an admin; leaving is POST .../leave).
// Their tabs drop it, the others get the new member list (removeGroupMember).
export async function DELETE(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { conversationId, userId } = await params;
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
    if (!userId || !conversation.userIds.includes(userId)) {
      return new NextResponse("Not a member", { status: 404 });
    }
    if (!canRemoveMember(conversation, currentUser.id, userId)) {
      return new NextResponse("Not allowed to remove this member", { status: 403 });
    }

    await removeGroupMember(conversation, userId, currentUser.id);
    return new NextResponse("Success");
  } catch (error) {
    logError("conversation_remove_member", error);
    return new NextResponse("Error", { status: 500 });
  }
}
