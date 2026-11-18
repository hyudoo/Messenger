import prisma from "@/app/libs/prismadb";
import getCurrentUser from "./getCurrentUser";

// The signed-in user's own settings of a conversation (muted / pinned / archived), for the chat's drawer.
// User rows omit these lists (app/libs/prismadb.ts), so they are read here on their own.
const getConversationSettings = async (conversationId: string) => {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { muted: false, pinned: false, archived: false };
  }
  try {
    const settings = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { mutedConversationIds: true, pinnedConversationIds: true, archivedConversationIds: true },
    });
    return {
      muted: !!settings?.mutedConversationIds.includes(conversationId),
      pinned: !!settings?.pinnedConversationIds.includes(conversationId),
      archived: !!settings?.archivedConversationIds.includes(conversationId),
    };
  } catch {
    return { muted: false, pinned: false, archived: false };
  }
};

export default getConversationSettings;
