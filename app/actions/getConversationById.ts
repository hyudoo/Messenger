import getConversationForUser from "./getConversationForUser";
import getCurrentUser from "./getCurrentUser";
import { blockPartnersOf, hideLastSeen } from "@/app/libs/blocks";

// Returns null unless the signed-in user is a member of the conversation. Block partners come
// without their last active time.
const getConversationById = async (conversationId: string) => {
  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    return null;
  }

  const conversation = await getConversationForUser(conversationId, currentUser.id);
  if (!conversation) {
    return null;
  }
  const partners = await blockPartnersOf(currentUser.id).catch(() => new Map());
  return { ...conversation, users: hideLastSeen(conversation.users, partners) };
};

export default getConversationById;
