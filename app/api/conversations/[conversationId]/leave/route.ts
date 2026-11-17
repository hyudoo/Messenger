import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canLeaveConversation } from "@/app/libs/conversation-permissions";
import { removeGroupMember } from "@/app/libs/conversation-members";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// Leaves a group (removeGroupMember: the caller's tabs drop it, the others get the new member
// list, the owner leaving hands it on, the last member leaving deletes it).
export async function POST(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { conversationId } = await params;
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser?.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const conversation = await getConversationForUser(conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canLeaveConversation(conversation)) {
      return new NextResponse("Only groups can be left", { status: 400 });
    }

    await removeGroupMember(conversation, currentUser.id);
    return new NextResponse("Success");
  } catch (error) {
    logError("conversation_leave", error);
    return new NextResponse("Error", { status: 500 });
  }
}
