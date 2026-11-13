import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { emitToUser } from "@/app/libs/socket-server";
import prisma from "@/app/libs/prismadb";
import { cleanUpUploads } from "@/app/libs/upload-cleanup";

interface IParams {
  conversationId?: string;
}

// Prisma has no $pull for scalar lists, so remove the deleted messages from the
// members' User.seenMessageIds with one raw update. Runs in the background:
// a failure only leaves stale ids behind.
const pullSeenMessageIds = (userIds: string[], messageIds: string[]) => {
  if (userIds.length === 0 || messageIds.length === 0) {
    return;
  }
  prisma
    .$runCommandRaw({
      update: "User",
      updates: [
        {
          q: { _id: { $in: userIds.map((id) => ({ $oid: id })) } },
          u: {
            $pull: {
              seenMessageIds: { $in: messageIds.map((id) => ({ $oid: id })) },
            },
          },
          multi: true,
        },
      ],
    })
    .catch((error) => console.log(error, "ERROR_PULL_SEEN_MESSAGE_IDS"));
};

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

    // messages go with the conversation (cascade); collect what has to be
    // cleaned up afterwards: their images on S3 and their ids in seenMessageIds
    const messages = await prisma.message.findMany({
      where: { conversationId: existingConversation.id },
      select: { id: true, image: true },
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

    cleanUpUploads(messages.map((message) => message.image));
    pullSeenMessageIds(
      existingConversation.userIds,
      messages.map((message) => message.id)
    );

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
