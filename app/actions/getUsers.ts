import prisma from "@/app/libs/prismadb";
import getSession from "./getSession";
import getCurrentUser from "./getCurrentUser";
import { blockPartnersOf, hideLastSeen } from "@/app/libs/blocks";

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

    // block partners come without their last active time
    const currentUser = await getCurrentUser();
    const partners = currentUser
      ? await blockPartnersOf(currentUser.id).catch(() => new Map())
      : new Map();
    return hideLastSeen(users, partners);
  } catch (error: any) {
    return [];
  }
};

export default getUsers;
