import prisma from "./prismadb";

// Blocking (User.blockedUserIds, private like the muted list). It works both ways: once either
// of two people blocks the other, they can't message or call each other in their 1:1 chat, and
// neither sees the other's online status, last active time or typing. Groups are not affected.

// Whether either of the two has blocked the other.
export const isBlockedBetween = async (aId: string, bId: string) =>
  (await prisma.user.count({
    where: {
      OR: [
        { id: aId, blockedUserIds: { has: bId } },
        { id: bId, blockedUserIds: { has: aId } },
      ],
    },
  })) > 0;

// Everyone the user blocked or was blocked by (ids and emails).
export const blockPartnersOf = async (userId: string) => {
  const [own, blockers] = await Promise.all([
    prisma.user.findUnique({ where: { id: userId }, select: { blockedUserIds: true } }),
    prisma.user.findMany({
      where: { blockedUserIds: { has: userId } },
      select: { id: true, email: true },
    }),
  ]);
  const blocked = own?.blockedUserIds.length
    ? await prisma.user.findMany({
        where: { id: { in: own.blockedUserIds } },
        select: { id: true, email: true },
      })
    : [];
  const partners = new Map<string, string | null>();
  [...blocked, ...blockers].forEach((user) => partners.set(user.id, user.email));
  return partners;
};

// The 1:1 chat's block state for the signed-in user: who blocked whom.
export const blockStateWith = async (userId: string, otherId: string) => {
  const rows = await prisma.user.findMany({
    where: { id: { in: [userId, otherId] } },
    select: { id: true, blockedUserIds: true },
  });
  const mine = rows.find((row) => row.id === userId);
  const theirs = rows.find((row) => row.id === otherId);
  return {
    byMe: !!mine?.blockedUserIds.includes(otherId),
    byThem: !!theirs?.blockedUserIds.includes(userId),
  };
};

// User rows as a blocked partner may see them: no last active time. The same array when
// nobody is blocked (the usual case).
export const hideLastSeen = <T extends { id: string; lastSeenAt?: Date | null }>(
  users: T[],
  partners: Map<string, unknown> | Set<string>
) =>
  partners.size === 0
    ? users
    : users.map((user) => (partners.has(user.id) ? { ...user, lastSeenAt: null } : user));
