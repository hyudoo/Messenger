import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { emitToUser } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { cleanUpUploads } from "@/app/libs/upload-cleanup";

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

    // images go with their messages (cascade); collect them first to clean up S3
    const imageMessages = await prisma.message.findMany({
      where: { conversationId: existingConversation.id, image: { not: null } },
      select: { image: true },
    });

    // On MongoDB a delete leaves the id in every member's User.conversationIds;
    // disconnecting the members first updates both sides of the many-to-many.
    const [, deletedConversation] = await prisma.$transaction([
      prisma.conversation.update({
        where: { id: existingConversation.id },
        data: { users: { set: [] } },
      }),
      prisma.conversation.delete({
        where: {
          id: existingConversation.id,
        },
      }),
    ]);

    cleanUpUploads(imageMessages.map((message) => message.image));

    existingConversation.users.forEach((user) => {
      if (user.email) {
        emitToUser(user.email, "conversation:remove", existingConversation);
      }
    });

    return NextResponse.json(deletedConversation);
  } catch (error) {
    console.log(error, "ERROR_CONVERSATION_DELETE");
    return new NextResponse("Error", { status: 500 });
  }
}
