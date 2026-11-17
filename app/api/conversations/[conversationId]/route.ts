import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canDeleteConversation } from "@/app/libs/conversation-permissions";
import { deleteConversation } from "@/app/libs/conversation-delete";

interface IParams {
  conversationId?: string;
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
    console.log(error, "ERROR_CONVERSATION_DELETE");
    return new NextResponse("Error", { status: 500 });
  }
}
