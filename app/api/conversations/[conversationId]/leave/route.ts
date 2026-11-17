import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canLeaveConversation } from "@/app/libs/conversation-permissions";
import { deleteConversation } from "@/app/libs/conversation-delete";
import { emitToUser, removeUserFromConversationRoom } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// Leaves a group: the caller is disconnected from it (both sides of the many-to-many), their tabs
// drop it (conversation:remove) and leave its room, the others get the new member list
// (conversation:update with users). The owner leaving passes the group on to another member; the
// last member leaving deletes it.
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

    const remaining = conversation.users.filter((user) => user.id !== currentUser.id);
    if (remaining.length === 0) {
      await deleteConversation(conversation);
      return new NextResponse("Success");
    }

    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        users: { disconnect: { id: currentUser.id } },
        // a group without an owner stays deletable by anyone, so hand it on
        ...(conversation.ownerId === currentUser.id && { ownerId: remaining[0].id }),
      },
      include: { users: true },
    });

    emitToUser(currentUser.email, "conversation:remove", { id: conversation.id });
    removeUserFromConversationRoom(currentUser.email, conversation.id);

    updated.users.forEach((user) => {
      if (user.email) {
        emitToUser(user.email, "conversation:update", {
          id: updated.id,
          users: updated.users,
          userIds: updated.userIds,
          ownerId: updated.ownerId,
        });
      }
    });

    return new NextResponse("Success");
  } catch (error) {
    logError("conversation_leave", error);
    return new NextResponse("Error", { status: 500 });
  }
}
