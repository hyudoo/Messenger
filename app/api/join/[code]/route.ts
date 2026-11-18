import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { findInvitedGroup } from "@/app/actions/getInvite";
import { emitGroupUpdate, joinGroup } from "@/app/libs/conversation-members";
import { MAX_JOIN_REQUESTS } from "@/app/libs/invite-code";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  code?: string;
}

// POST: joins the group behind an invite link (any signed-in user while the link is on). Already a
// member: nothing changes. Returns { conversationId } for the page to open.
// When the group needs an admin's approval (Conversation.joinApproval) it files a request instead
// (Conversation.joinRequestIds, at most MAX_JOIN_REQUESTS: 409) and returns { requested: true };
// the members get the new list (conversation:update), so the admins see it.
export async function POST(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { code } = await params;
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // also slows down guessing codes
    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const group = await findInvitedGroup(code);
    if (!group) {
      return new NextResponse("Invalid or expired link", { status: 404 });
    }
    if (group.userIds.includes(currentUser.id)) {
      return NextResponse.json({ conversationId: group.id });
    }
    if (group.joinApproval) {
      const waiting = group.joinRequestIds ?? [];
      if (!waiting.includes(currentUser.id)) {
        if (waiting.length >= MAX_JOIN_REQUESTS) {
          return new NextResponse("Too many people are waiting to join", { status: 409 });
        }
        const updated = await prisma.conversation.update({
          where: { id: group.id },
          data: { joinRequestIds: { push: currentUser.id } },
          include: { users: true },
        });
        await emitGroupUpdate(updated, updated.users);
      }
      return NextResponse.json({ requested: true });
    }
    await joinGroup(group, currentUser);
    return NextResponse.json({ conversationId: group.id });
  } catch (error) {
    logError("conversation_join", error);
    return new NextResponse("Error", { status: 500 });
  }
}
