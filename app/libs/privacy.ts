import prisma from "./prismadb";

// Privacy settings (User.hideActivity / hideReadReceipts, private like the block list). Both
// work both ways, like Messenger's active status: hiding yours also hides everyone else's from you.

export type PrivacySettings = { hideActivity: boolean; hideReadReceipts: boolean };

export const privacyOf = async (userId: string): Promise<PrivacySettings> => {
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { hideActivity: true, hideReadReceipts: true },
  });
  return { hideActivity: !!row?.hideActivity, hideReadReceipts: !!row?.hideReadReceipts };
};

// Whose last active time the viewer may not see among these users: everyone when the viewer hides
// their own activity, else those who hide theirs (the viewer's own row stays). Added to the block
// partners for hideLastSeen.
export const activityHiddenAmong = async (viewerId: string, userIds: string[]) => {
  const others = userIds.filter((id) => id !== viewerId);
  if (others.length === 0) {
    return new Set<string>();
  }
  if ((await privacyOf(viewerId)).hideActivity) {
    return new Set(others);
  }
  const hiding = await prisma.user.findMany({
    where: { id: { in: others }, hideActivity: true },
    select: { id: true },
  });
  return new Set(hiding.map((user) => user.id));
};

// The members of a conversation as each of them may see them, for socket payloads sent to every
// member (group updates, conversation:new): `lastSeenAt` is nulled, like the loaders do, for those
// who hide their activity, for everyone when the viewer hides theirs, and between block partners
// (either side). One query for the whole list. On a database error everyone's is nulled.
export const lastSeenViewsOf = async <T extends { id: string; lastSeenAt?: Date | null }>(
  users: T[]
): Promise<(viewerId: string) => T[]> => {
  const rows = await prisma.user
    .findMany({
      where: { id: { in: users.map((user) => user.id) } },
      select: { id: true, hideActivity: true, blockedUserIds: true },
    })
    .catch(() => null);
  if (!rows) {
    const none = users.map((user) => ({ ...user, lastSeenAt: null }));
    return () => none;
  }
  const byId = new Map(rows.map((row) => [row.id, row]));
  return (viewerId) => {
    const viewer = byId.get(viewerId);
    return users.map((user) => {
      if (user.id === viewerId) {
        return user;
      }
      const other = byId.get(user.id);
      const hidden =
        !!viewer?.hideActivity ||
        !!other?.hideActivity ||
        !!viewer?.blockedUserIds.includes(user.id) ||
        !!other?.blockedUserIds.includes(viewerId);
      return hidden ? { ...user, lastSeenAt: null } : user;
    });
  };
};
