import prisma from "@/app/libs/prismadb";
import { UNREAD_SCAN_LIMIT, countUnread } from "@/app/libs/unread";
import getCurrentUser from "./getCurrentUser";
import { blockPartnersOf, hideLastSeen } from "@/app/libs/blocks";
import { activityHiddenAmong } from "@/app/libs/privacy";
import { hiddenAmong, lastVisibleMessage } from "@/app/libs/inbox-preview";

// Unread count of one conversation: scans its newest messages (index conversationId + createdAt)
// back to the user's read marker, at most UNREAD_SCAN_LIMIT of them.
const unreadIn = async (conversationId: string, userId: string) =>
  countUnread(
    await prisma.message.findMany({
      where: { conversationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: UNREAD_SCAN_LIMIT,
      // privateSeenIds: the user's reads while hiding read receipts
      select: { senderId: true, seenIds: true, privateSeenIds: true },
    }),
    userId
  );

// The user's conversations, latest activity first, each with only its last message and the
// number of messages the user hasn't seen. Throws on a database error (GET /api/conversations
// answers 500 then, so the client keeps the list it has).
export const findConversationsForUser = async (userId: string) => {
  // the user's own muted / pinned lists (omitted from user rows by default)
  const settings = await prisma.user.findUnique({
    where: { id: userId },
    select: { mutedConversationIds: true, pinnedConversationIds: true, archivedConversationIds: true },
  });
  const conversations = await prisma.conversation.findMany({
    orderBy: {
      lastMessageAt: "desc",
    },
    where: {
      userIds: {
        has: userId,
      },
    },
    include: {
      users: true,
      // the list only shows the last message
      messages: {
        orderBy: {
          createdAt: "desc",
        },
        take: 1,
        include: {
          sender: true,
          seen: true,
        },
      },
    },
  });

  // block partners and hidden activity come without their last active time
  const [partners, hidden] = await Promise.all([
    blockPartnersOf(userId).catch(() => new Map<string, string | null>()),
    activityHiddenAmong(
      userId,
      Array.from(new Set(conversations.flatMap((conversation) => conversation.userIds)))
    ).catch(() => new Set<string>()),
  ]);
  const noLastSeen = new Set([...Array.from(partners.keys()), ...Array.from(hidden)]);

  // a last message the user deleted for themselves isn't their preview: the newest one they can
  // still see is (looked up only for those conversations, usually none)
  const hiddenLast = await hiddenAmong(
    conversations.flatMap((conversation) => conversation.messages.map((message) => message.id)),
    userId
  );

  // only conversations whose last message is unread need a scan (usually few)
  return Promise.all(
    conversations.map(async (conversation) => {
      if (conversation.messages[0] && hiddenLast.has(conversation.messages[0].id)) {
        const visible = await lastVisibleMessage(conversation.id, userId);
        conversation = { ...conversation, messages: visible ? [visible] : [] };
      }
      const last = conversation.messages[0];
      const unread =
        last && last.senderId !== userId && !last.seenIds.includes(userId)
          ? await unreadIn(conversation.id, userId)
          : 0;
      return {
        ...conversation,
        users: hideLastSeen(conversation.users, noLastSeen),
        unreadCount: unread,
        muted: !!settings?.mutedConversationIds.includes(conversation.id),
        pinned: !!settings?.pinnedConversationIds.includes(conversation.id),
        archived: !!settings?.archivedConversationIds.includes(conversation.id),
      };
    })
  );
};

const getConversations = async () => {
  const currentUser = await getCurrentUser();

  if (!currentUser?.id) {
    return [];
  }

  try {
    return await findConversationsForUser(currentUser.id);
  } catch (error: any) {
    return [];
  }
};
export default getConversations;
