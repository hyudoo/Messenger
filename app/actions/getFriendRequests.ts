import prisma from "@/app/libs/prismadb";
import getCurrentUser from "./getCurrentUser";

const PERSON = { select: { id: true, name: true, image: true } } as const;

// The friend requests waiting for the user (incoming: accept / decline) and the ones they sent
// (outgoing: cancel), newest first, with the other person's name and photo (no email).
const getFriendRequests = async () => {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { incoming: [], outgoing: [] };
  }
  try {
    const [incoming, outgoing] = await Promise.all([
      prisma.friendRequest.findMany({
        where: { toId: currentUser.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, from: PERSON },
      }),
      prisma.friendRequest.findMany({
        where: { fromId: currentUser.id },
        orderBy: { createdAt: "desc" },
        select: { id: true, createdAt: true, to: PERSON },
      }),
    ]);
    return {
      incoming: incoming.map(({ from, ...request }) => ({ ...request, user: from })),
      outgoing: outgoing.map(({ to, ...request }) => ({ ...request, user: to })),
    };
  } catch {
    return { incoming: [], outgoing: [] };
  }
};

export type FriendRequestItem = Awaited<ReturnType<typeof getFriendRequests>>["incoming"][number];

export default getFriendRequests;
