import prisma from "./prismadb";
import { deleteConversation } from "./conversation-delete";
import { postSystemMessage } from "./system-message";
import { emitToUser, removeUserFromConversationRoom } from "./socket-server";
import { ConversationWithUsers, SafeUser } from "@/app/types";

// Sends a group's new member list (and name / owner / admins / photo / invite code) to its
// members' tabs: the inbox updates the item and an open chat refreshes its header and drawer
// (ConversationList).
export const emitGroupUpdate = (conversation: ConversationWithUsers, to: SafeUser[]) => {
  to.forEach((user) => {
    if (user.email) {
      emitToUser(user.email, "conversation:update", {
        id: conversation.id,
        name: conversation.name,
        users: conversation.users,
        userIds: conversation.userIds,
        ownerId: conversation.ownerId,
        adminIds: conversation.adminIds ?? [],
        image: conversation.image ?? null,
        inviteCode: conversation.inviteCode ?? null,
      });
    }
  });
};

// Takes a member out of a group: leaving (actorId = memberId) or removed by the owner (callers
// check who may). Their tabs drop it (conversation:remove) and leave its room, the others get the
// new member list and a group event. The owner going hands the group on to an admin (else another
// member); the last member going deletes it.
export const removeGroupMember = async (
  conversation: ConversationWithUsers,
  memberId: string,
  actorId: string = memberId
) => {
  const member = conversation.users.find((user) => user.id === memberId);
  const remaining = conversation.users.filter((user) => user.id !== memberId);
  if (remaining.length === 0) {
    await deleteConversation(conversation);
    return null;
  }

  const adminIds = conversation.adminIds ?? [];
  // a group without an owner stays deletable by anyone, so hand it on: to an admin first
  const nextOwner =
    conversation.ownerId === memberId
      ? remaining.find((user) => adminIds.includes(user.id)) ?? remaining[0]
      : null;
  const nextAdmins = adminIds.filter((id) => id !== memberId && id !== nextOwner?.id);

  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      users: { disconnect: { id: memberId } },
      ...(nextOwner && { ownerId: nextOwner.id }),
      ...(nextAdmins.length !== adminIds.length && { adminIds: { set: nextAdmins } }),
    },
    include: { users: true },
  });

  if (member?.email) {
    emitToUser(member.email, "conversation:remove", { id: conversation.id });
    removeUserFromConversationRoom(member.email, conversation.id);
  }
  emitGroupUpdate(updated, updated.users);
  await postSystemMessage(
    actorId === memberId
      ? { conversation: updated, actorId, type: "left" }
      : { conversation: updated, actorId, type: "removed", users: member ? [member] : [] }
  );
  return updated;
};

// Adds the user to a group through its invite link (callers check the code). The members get the
// new list and a "joined" event; the user's tabs get the conversation for their inbox, the event
// being its read marker (so the history from before doesn't count as unread).
export const joinGroup = async (conversation: ConversationWithUsers, user: SafeUser) => {
  const updated = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { users: { connect: { id: user.id } } },
    include: { users: true },
  });
  emitGroupUpdate(updated, conversation.users);
  const event = await postSystemMessage({
    conversation: updated,
    actorId: user.id,
    type: "joined",
  });
  if (user.email) {
    emitToUser(user.email, "conversation:new", {
      ...updated,
      messages: event ? [event] : [],
      unreadCount: 0,
    });
  }
  return updated;
};
