// Unread messages of a conversation for one user. "Seen" marks only the last message
// (POST /api/conversations/[id]/seen), so the newest message the user has seen is their read
// marker: unread = the messages from others after it.
export const UNREAD_SCAN_LIMIT = 100; // shown as "99+" beyond this

type Scanned = { senderId: string; seenIds: string[] };

// `newestFirst`: the latest messages, newest first (at most UNREAD_SCAN_LIMIT).
export const countUnread = (newestFirst: Scanned[], userId: string) => {
  let count = 0;
  for (const message of newestFirst) {
    // the user's own messages count as read (they are created seen by the sender)
    if (message.seenIds.includes(userId) || message.senderId === userId) {
      break;
    }
    count += 1;
  }
  return count;
};

export const formatUnread = (count: number) => (count > 99 ? "99+" : String(count));
