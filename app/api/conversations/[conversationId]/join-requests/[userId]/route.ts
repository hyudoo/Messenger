import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canManageInvite } from "@/app/libs/conversation-permissions";
import { joinGroup } from "@/app/libs/conversation-members";
import { joinRequestIdsOf, notifyJoinRequestsChanged } from "@/app/libs/join-requests";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { emitToUser } from "@/app/libs/socket-server";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
  userId?: string;
}

// POST { approve }: an admin answers a request to join by the invite link. Approving adds them like
// joining does (joinGroup: a "joined" event, their tabs get conversation:new, which takes a waiting
// join page into the chat); declining drops the request and tells their tabs (join:declined).
// Either way the admins' tabs reload their list (join-requests:update).
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
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
    if (typeof body?.approve !== "boolean") {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const conversation = await getConversationForUser(conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canManageInvite(conversation, currentUser.id)) {
      return new NextResponse("Only group admins can answer join requests", { status: 403 });
    }
    const waiting = await joinRequestIdsOf(conversation.id);
    const requester =
      userId && waiting.includes(userId)
        ? await prisma.user.findUnique({ where: { id: userId } })
        : null;
    if (!userId || !waiting.includes(userId)) {
      return new NextResponse("No such request", { status: 404 });
    }

    // the account is gone, or they joined some other way meanwhile: just drop the request
    if (body.approve && requester && !conversation.userIds.includes(requester.id)) {
      await joinGroup(conversation, requester);
      return NextResponse.json({ approved: true });
    }

    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { joinRequestIds: { set: waiting.filter((id) => id !== userId) } },
      select: { id: true },
    });
    notifyJoinRequestsChanged(conversation);
    if (!body.approve && requester?.email) {
      emitToUser(requester.email, "join:declined", { conversationId: conversation.id });
    }
    return NextResponse.json({ approved: false });
  } catch (error) {
    logError("join_request_answer", error);
    return new NextResponse("Error", { status: 500 });
  }
}
