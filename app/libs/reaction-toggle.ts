import type { MessageReaction } from "@/app/types";

// The user's own row in an optimistic list (the session has no user id; rows are matched by email).
export const OPTIMISTIC_USER_ID = "me";

// What POST /api/messages/[id]/reactions will do, applied locally so the chip changes at once:
// the same emoji again removes the user's reaction, another emoji replaces it (one per user).
// The new reaction goes last, like the server's `createdAt` order.
export function toggleReaction(
  reactions: MessageReaction[],
  me: { email: string; name: string | null },
  emoji: string
): MessageReaction[] {
  const mine = reactions.find((reaction) => reaction.user.email === me.email);
  const others = reactions.filter((reaction) => reaction.user.email !== me.email);
  if (mine?.emoji === emoji) {
    return others;
  }
  return [
    ...others,
    { emoji, userId: mine?.userId ?? OPTIMISTIC_USER_ID, user: { name: me.name, email: me.email } },
  ];
}
