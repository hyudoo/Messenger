import prisma from "./prismadb";
import { deleteConversation } from "./conversation-delete";
import { emitToUser, removeUserFromConversationRoom } from "./socket-server";
import { ConversationWithUsers, SafeUser } from "@/app/types";

// Sends a group's new member list (and name / owner) to its members' tabs: the inbox updates
// the item and an open chat refreshes its header and drawer (ConversationList).
export const emitGroupUpdate = (conversation: ConversationWithUsers, to: SafeUser[]) => {
  to.forEach((user) => {
    if (user.email) {
      emitToUser(user.email, "conversation:update", {
        id: conversation.id,
        name: conversation.name,
        users: conversation.users,
        userIds: conversation.userIds,
        ownerId: conversation.ownerId,
      });
    }
  });
};

// Takes a member out of a group (leaving, or removed by the owner; callers check who may).
// Their tabs drop it (conversation:remove) and leave its room, the others get the new member
// list. The owner going hands the group on to another member; the last member going deletes it.
export const removeGroupMember = async (conversation: ConversationWithUsers, memberId: string) => {
  const member = conversation.users.find((user) => user.id === memberId);
  const remaining = conversation.users.filter((user) => user.id !== memberId);
  if (remaining.length === 0) {
    await deleteConversation(conversation);
    return null;
  }

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      users: { disconnect: { id: memberId } },
      // a group without an owner stays deletable by anyone, so hand it on
      ...(conversation.ownerId === memberId && { ownerId: remaining[0].id }),
    },
    include: { users: true },
  });

  if (member?.email) {
    emitToUser(member.email, "conversation:remove", { id: conversation.id });
    removeUserFromConversationRoom(member.email, conversation.id);
  }
  emitGroupUpdate(updated, updated.users);
  return updated;
};
