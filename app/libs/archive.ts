import prisma from "./prismadb";
import { logError } from "./log";

// Archived conversations (User.archivedConversationIds, private): out of the user's inbox list,
// under "Archived", until something new is posted there. Then they come back for every member
// who archived them (like Messenger); the inbox does the same on its side when the
// conversation:update with lastMessageAt arrives.
// One raw update: Prisma has no $pull for scalar lists on MongoDB. Never throws.
export const unarchiveConversation = async (conversationId: string) => {
  try {
    await prisma.$runCommandRaw({
      update: "User",
      updates: [
        {
          q: { archivedConversationIds: { $oid: conversationId } },
          u: { $pull: { archivedConversationIds: { $oid: conversationId } } },
          multi: true,
        },
      ],
    });
  } catch (error) {
    logError("unarchive_conversation", error);
  }
};
