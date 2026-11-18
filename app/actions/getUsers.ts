import prisma from "@/app/libs/prismadb";
import getSession from "./getSession";
import getCurrentUser from "./getCurrentUser";
import { blockPartnersOf, hideLastSeen } from "@/app/libs/blocks";
import { activityHiddenAmong } from "@/app/libs/privacy";

const getUsers = async () => {
  const session = await getSession();
  if (!session?.user?.email) {
    return [];
  }

  try {
    const users = await prisma.user.findMany({
      orderBy: {
        createdAt: "desc",
      },
      where: {
        NOT: {
          email: session.user.email,
        },
      },
    });

    // block partners and hidden activity come without their last active time
    const currentUser = await getCurrentUser();
    if (!currentUser) {
      return users;
    }
    const [partners, hidden] = await Promise.all([
      blockPartnersOf(currentUser.id).catch(() => new Map<string, string | null>()),
      activityHiddenAmong(
        currentUser.id,
        users.map((user) => user.id)
      ).catch(() => new Set<string>()),
    ]);
    return hideLastSeen(users, new Set([...Array.from(partners.keys()), ...Array.from(hidden)]));
  } catch (error: any) {
    return [];
  }
};

export default getUsers;
