import prisma from "@/app/libs/prismadb";
import getCurrentUser from "./getCurrentUser";
import { blockPartnersOf, hideLastSeen } from "@/app/libs/blocks";
import { friendIdsOf } from "@/app/libs/friends";
import { activityHiddenAmong } from "@/app/libs/privacy";

// The user's friends (app/libs/friends.ts), by name: the contacts page, and the people a new group
// or a group's "Add" picks from. Others are found with "Find people" (GET /api/users/search).
const getUsers = async () => {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return [];
  }

  try {
    const friendIds = await friendIdsOf(currentUser.id);
    if (friendIds.length === 0) {
      return [];
    }
    const users = await prisma.user.findMany({
      where: { id: { in: friendIds } },
      orderBy: { name: "asc" },
    });

    // block partners and hidden activity come without their last active time
    const [partners, hidden] = await Promise.all([
      blockPartnersOf(currentUser.id).catch(() => new Map<string, string | null>()),
      activityHiddenAmong(
        currentUser.id,
        users.map((user) => user.id)
      ).catch(() => new Set<string>()),
    ]);
    return hideLastSeen(users, new Set([...Array.from(partners.keys()), ...Array.from(hidden)]));
  } catch {
    return [];
  }
};

export default getUsers;
