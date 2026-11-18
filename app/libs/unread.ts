// Unread messages of a conversation for one user. "Seen" marks only the last message
// (POST /api/conversations/[id]/seen), so the newest message the user has seen is their read
// marker: unread = the messages from others after it.
export const UNREAD_SCAN_LIMIT = 100; // shown as "99+" beyond this

// privateSeenIds: reads of users who hide their read receipts (server-side only)
type Scanned = { senderId: string; seenIds: string[]; privateSeenIds?: string[] };

// Whether the user has read the message (their own count as read), privately or not.
export const hasRead = (message: Scanned, userId: string) =>
  message.senderId === userId ||
  message.seenIds.includes(userId) ||
  !!message.privateSeenIds?.includes(userId);

// `newestFirst`: the latest messages, newest first (at most UNREAD_SCAN_LIMIT).
export const countUnread = (newestFirst: Scanned[], userId: string) => {
  let count = 0;
  for (const message of newestFirst) {
    // the user's own messages count as read (they are created seen by the sender)
    if (hasRead(message, userId)) {
      break;
    }
    count += 1;
  }
  return count;
};

// The first unread message of a page (oldest first), where the chat puts its "new messages"
// divider; null when everything is read. The same read marker as countUnread.
export const findFirstUnread = <T extends Scanned & { id: string }>(
  oldestFirst: T[],
  userId: string
) => {
  let first: string | null = null;
  for (let i = oldestFirst.length - 1; i >= 0; i--) {
    const message = oldestFirst[i];
    if (hasRead(message, userId)) {
      break;
    }
    first = message.id;
  }
  return first;
};

export const formatUnread = (count: number) => (count > 99 ? "99+" : String(count));
