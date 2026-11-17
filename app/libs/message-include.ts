import type { Prisma } from "@prisma/client";

// Messages not recalled. On MongoDB `deletedAt: null` alone may skip documents written before the
// field existed (field missing, not null), so both cases are listed.
export const NOT_RECALLED = {
  OR: [{ deletedAt: null }, { deletedAt: { isSet: false } }],
} satisfies Prisma.MessageWhereInput;

// The preview of a replied-to message shown above a reply (MessageBox's ReplyQuote).
export const REPLY_PREVIEW_SELECT = {
  id: true,
  body: true,
  image: true,
  isCall: true,
  deletedAt: true,
  sender: { select: { name: true, email: true } },
} satisfies Prisma.MessageSelect;

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
  replyTo: { select: REPLY_PREVIEW_SELECT },
} satisfies Prisma.MessageInclude;
