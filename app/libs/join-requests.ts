import prisma from "./prismadb";
import { isGroupAdmin } from "./conversation-permissions";
import { emitToUser } from "./socket-server";
import { ConversationWithUsers } from "@/app/types";

// Requests to join a group by its invite link while an admin must approve
// (Conversation.joinRequestIds). Who asked is the admins' business only: the field is omitted from
// conversation rows (app/libs/prismadb.ts), read here with a `select`, and changes reach the
// admins' tabs only (join-requests:update; GroupInvite reloads its list).

// who is waiting to join this group, oldest first
export const joinRequestIdsOf = async (conversationId: string) => {
  const row = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { joinRequestIds: true },
  });
  return row?.joinRequestIds ?? [];
};

export const notifyJoinRequestsChanged = (conversation: ConversationWithUsers) => {
  conversation.users.forEach((user) => {
    if (user.email && isGroupAdmin(conversation, user.id)) {
      emitToUser(user.email, "join-requests:update", { conversationId: conversation.id });
    }
  });
};
