// Who may do what with a conversation. Shared by the API routes and the profile drawer, so the UI
// only offers what the server allows.
type ConversationRoles = {
  isGroup?: boolean | null;
  ownerId?: string | null;
  // missing on groups from before admins (and in socket payloads of older servers)
  adminIds?: string[] | null;
};

// The owner, the admins they picked, or anyone in a group from before ownerId existed.
export const isGroupAdmin = (conversation: ConversationRoles, userId: string) =>
  !!conversation.isGroup &&
  (!conversation.ownerId ||
    conversation.ownerId === userId ||
    !!conversation.adminIds?.includes(userId));

// Only the owner makes or unmakes admins (not of themselves: they are always one).
export const canManageAdmins = (
  conversation: ConversationRoles,
  userId: string,
  memberId: string
) =>
  !!conversation.isGroup &&
  !!conversation.ownerId &&
  conversation.ownerId === userId &&
  memberId !== userId;

// Admins turn the invite link on, reset or off; every member sees it while it is on.
export const canManageInvite = isGroupAdmin;

// A 1:1 chat: either member. A group is deleted for everyone, so only its owner; groups from before
// ownerId existed have no owner, and any member may delete them as before.
export const canDeleteConversation = (conversation: ConversationRoles, userId: string) =>
  !conversation.isGroup || !conversation.ownerId || conversation.ownerId === userId;

// Only groups can be left; a 1:1 chat is deleted instead.
export const canLeaveConversation = (conversation: ConversationRoles) => !!conversation.isGroup;

// Any member of a group may rename it, change its photo and add people (like Messenger's default).
export const canEditGroup = (conversation: ConversationRoles) => !!conversation.isGroup;

// An admin may remove another member (leaving is for oneself), but never the owner, and only the
// owner removes another admin. Groups from before ownerId existed have no owner: any member may,
// as with deleting them.
export const canRemoveMember = (
  conversation: ConversationRoles,
  userId: string,
  memberId: string
) => {
  if (!conversation.isGroup || memberId === userId || !isGroupAdmin(conversation, userId)) {
    return false;
  }
  if (!conversation.ownerId) {
    return true;
  }
  if (memberId === conversation.ownerId) {
    return false;
  }
  return conversation.ownerId === userId || !conversation.adminIds?.includes(memberId);
};

// the most admins an owner may pick (besides themselves)
export const MAX_ADMINS = 20;

export const MAX_GROUP_NAME_LENGTH = 100;

// conversations a user may pin to the top of their inbox
export const MAX_PINNED = 5;

// A group name as stored (trimmed), or null when it is missing, blank or too long.
export const normalizeGroupName = (name: unknown) => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed && trimmed.length <= MAX_GROUP_NAME_LENGTH ? trimmed : null;
};
