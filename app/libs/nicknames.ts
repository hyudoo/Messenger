// Nicknames in a conversation (Conversation.nicknames): what its members call each other there,
// shown instead of their names in that conversation only. Shared by the route and the UI.

export const MAX_NICKNAME_LENGTH = 40;

export type Nickname = { userId: string; nickname: string };

// the nickname from a request: trimmed, inner spaces collapsed; "" / null removes it; undefined
// when it is too long or not text
export const parseNickname = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const nickname = value.replace(/\s+/g, " ").trim();
  if (nickname.length > MAX_NICKNAME_LENGTH) {
    return undefined;
  }
  return nickname || null;
};

// the list with the user's nickname set (or removed with null), keeping the others' order
export const withNickname = (nicknames: Nickname[], userId: string, nickname: string | null) => [
  ...nicknames.filter((item) => item.userId !== userId),
  ...(nickname ? [{ userId, nickname }] : []),
];

export const nicknameOf = (nicknames: Nickname[] | null | undefined, userId?: string | null) =>
  (userId && nicknames?.find((item) => item.userId === userId)?.nickname) || null;

// what to call a member in this conversation: their nickname there, else their name
export const displayName = (
  user: { id: string; name: string | null } | null | undefined,
  nicknames: Nickname[] | null | undefined
) => (user ? nicknameOf(nicknames, user.id) ?? user.name : null);
