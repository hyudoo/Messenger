import type { Prisma } from "@prisma/client";

// What every message sent to the chat view carries (FullMessageType): pages,
// messages:new and every messages:update. A messages:update replaces the
// message on the client, so an emit without reactions would wipe them there.
export const MESSAGE_INCLUDE = {
  sender: true,
  seen: true,
  reactions: {
    select: {
      emoji: true,
      userId: true,
      user: { select: { name: true, email: true } },
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.MessageInclude;
