import prisma from "./prismadb";
import { emitToUser, removeUserFromConversationRoom } from "./socket-server";
import { cleanUpUploads } from "./upload-cleanup";
import { ConversationWithUsers } from "@/app/types";
import { logError } from "./log";

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
    .catch((error) => logError("pull_seen_message_ids", error));
};

// Deletes a conversation for all its members (callers check who may): DELETE /api/conversations/[id],
// and the last member leaving a group. Tells every member (conversation:remove) and takes their
// sockets out of the conversation room.
export const deleteConversation = async (conversation: ConversationWithUsers) => {
  // messages go with the conversation (cascade); collect what has to be
  // cleaned up afterwards: their images on S3 and their ids in seenMessageIds
  const messages = await prisma.message.findMany({
    where: { conversationId: conversation.id },
    select: { id: true, image: true, attachment: true },
  });

  // On MongoDB a delete leaves the id in every member's User.conversationIds;
  // disconnecting the members first updates both sides of the many-to-many.
  const [, deletedConversation] = await prisma.$transaction([
    prisma.conversation.update({
      where: { id: conversation.id },
      data: { users: { set: [] } },
    }),
    prisma.conversation.delete({
      where: {
        id: conversation.id,
      },
    }),
  ]);

  cleanUpUploads(messages.flatMap((message) => [message.image, message.attachment?.url]));
  pullSeenMessageIds(
    conversation.userIds,
    messages.map((message) => message.id)
  );

  conversation.users.forEach((user) => {
    if (user.email) {
      emitToUser(user.email, "conversation:remove", conversation);
      removeUserFromConversationRoom(user.email, conversation.id);
    }
  });

  return deletedConversation;
};
