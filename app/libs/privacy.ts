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
