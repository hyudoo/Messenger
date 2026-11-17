import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canRemoveMember } from "@/app/libs/conversation-permissions";
import { removeGroupMember } from "@/app/libs/conversation-members";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
  userId?: string;
}

// Removes another member from a group (its owner only; leaving is POST .../leave).
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
      return new NextResponse("Only the group owner can remove members", { status: 403 });
    }

    await removeGroupMember(conversation, userId, currentUser.id);
    return new NextResponse("Success");
  } catch (error) {
    logError("conversation_remove_member", error);
    return new NextResponse("Error", { status: 500 });
  }
}
