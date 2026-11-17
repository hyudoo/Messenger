// Who may do what with a conversation. Shared by the API routes and the profile drawer, so the UI
// only offers what the server allows.
type ConversationRoles = { isGroup?: boolean | null; ownerId?: string | null };

// A 1:1 chat: either member. A group is deleted for everyone, so only its owner; groups from before
// ownerId existed have no owner, and any member may delete them as before.
export const canDeleteConversation = (conversation: ConversationRoles, userId: string) =>
  !conversation.isGroup || !conversation.ownerId || conversation.ownerId === userId;

// Only groups can be left; a 1:1 chat is deleted instead.
export const canLeaveConversation = (conversation: ConversationRoles) => !!conversation.isGroup;

// Any member of a group may rename it and add people (like Messenger's default).
export const canEditGroup = (conversation: ConversationRoles) => !!conversation.isGroup;

// The owner may remove another member (leaving is for oneself); groups from before ownerId
// existed have no owner, and any member may, as with deleting them.
export const canRemoveMember = (
  conversation: ConversationRoles,
  userId: string,
  memberId: string
) =>
  !!conversation.isGroup &&
  memberId !== userId &&
  (!conversation.ownerId || conversation.ownerId === userId);

export const MAX_GROUP_NAME_LENGTH = 100;

// A group name as stored (trimmed), or null when it is missing, blank or too long.
export const normalizeGroupName = (name: unknown) => {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed && trimmed.length <= MAX_GROUP_NAME_LENGTH ? trimmed : null;
};
