import getConversationForUser from "./getConversationForUser";
import getCurrentUser from "./getCurrentUser";
import { blockPartnersOf, hideLastSeen } from "@/app/libs/blocks";
import { activityHiddenAmong } from "@/app/libs/privacy";

// Returns null unless the signed-in user is a member of the conversation. Block partners and
// people whose activity is hidden (app/libs/privacy.ts) come without their last active time.
const getConversationById = async (conversationId: string) => {
  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    return null;
  }

  const conversation = await getConversationForUser(conversationId, currentUser.id);
  if (!conversation) {
    return null;
  }
  const [partners, hidden] = await Promise.all([
    blockPartnersOf(currentUser.id).catch(() => new Map<string, string | null>()),
    activityHiddenAmong(currentUser.id, conversation.userIds).catch(() => new Set<string>()),
  ]);
  return {
    ...conversation,
    users: hideLastSeen(conversation.users, new Set([...Array.from(partners.keys()), ...Array.from(hidden)])),
  };
};

export default getConversationById;
