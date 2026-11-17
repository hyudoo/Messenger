// Who may do what with a conversation. Shared by the API routes and the profile drawer, so the UI
// only offers what the server allows.
type ConversationRoles = { isGroup?: boolean | null; ownerId?: string | null };

// A 1:1 chat: either member. A group is deleted for everyone, so only its owner; groups from before
// ownerId existed have no owner, and any member may delete them as before.
export const canDeleteConversation = (conversation: ConversationRoles, userId: string) =>
  !conversation.isGroup || !conversation.ownerId || conversation.ownerId === userId;

// Only groups can be left; a 1:1 chat is deleted instead.
export const canLeaveConversation = (conversation: ConversationRoles) => !!conversation.isGroup;
