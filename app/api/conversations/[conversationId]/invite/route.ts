import { randomBytes } from "crypto";
import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canManageInvite } from "@/app/libs/conversation-permissions";
import { emitGroupUpdate } from "@/app/libs/conversation-members";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import prisma from "@/app/libs/prismadb";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// POST { enabled }: an admin turns the group's invite link on (a new code each time, so turning it
// on again resets it and the old link stops working) or off. The members get the code
// (conversation:update).
export async function POST(
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

    const body = await request.json().catch(() => ({}));
    if (typeof body?.enabled !== "boolean") {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const conversation = await getConversationForUser(conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canManageInvite(conversation, currentUser.id)) {
      return new NextResponse("Only group admins can manage the invite link", { status: 403 });
    }

    // 16 base64url characters (INVITE_CODE)
    const inviteCode = body.enabled ? randomBytes(12).toString("base64url") : null;
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { inviteCode },
      include: { users: true },
    });
    emitGroupUpdate(updated, updated.users);
    return NextResponse.json({ inviteCode });
  } catch (error) {
    logError("conversation_invite", error);
    return new NextResponse("Error", { status: 500 });
  }
}
