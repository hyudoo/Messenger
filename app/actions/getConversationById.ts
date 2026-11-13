import getConversationForUser from "./getConversationForUser";
import getCurrentUser from "./getCurrentUser";

// Returns null unless the signed-in user is a member of the conversation.
const getConversationById = async (conversationId: string) => {
  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    return null;
  }

  return getConversationForUser(conversationId, currentUser.id);
};

export default getConversationById;
