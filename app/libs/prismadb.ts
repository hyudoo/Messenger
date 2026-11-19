import { PrismaClient } from "@prisma/client";

// hashedPassword is never returned unless a query opts back in with
// `omit: { hashedPassword: false }` (only the credentials login does). The muted / pinned
// conversation lists, the session version, the blocked users, the friends and the privacy settings are the user's own business: user rows go to other members, so they are
// read only where needed (`select`).
const createClient = () =>
  new PrismaClient({
    omit: {
      user: {
        hashedPassword: true,
        sessionVersion: true,
        mutedConversationIds: true,
        pinnedConversationIds: true,
        archivedConversationIds: true,
        blockedUserIds: true,
        hideActivity: true,
        hideReadReceipts: true,
        friendIds: true,
      },
      // who hid a message for themselves, who read it privately, and the folded search text:
      // server-side only
      message: { hiddenForIds: true, privateSeenIds: true, searchText: true },
      // who asked to join a group by its link: for its admins only (app/libs/join-requests.ts)
      conversation: { joinRequestIds: true },
    },
  });

type AppPrismaClient = ReturnType<typeof createClient>;

declare global {
  var prisma: AppPrismaClient | undefined;
}

const client = globalThis.prisma || createClient();
if (process.env.NODE_ENV !== "production") globalThis.prisma = client;

export default client;
