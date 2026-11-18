import type { Prisma } from "@prisma/client";

import prisma from "./prismadb";
import { NOT_RECALLED, NOT_SYSTEM } from "./message-include";
import { normalizeSearch } from "./search";

// Searching text messages: in one conversation (GET /api/conversations/[id]/search) or in all of
// the user's (GET /api/search, the inbox). Matches Message.searchText (the body folded: no case, no
// Vietnamese diacritics); messages from before it (not backfilled yet) are matched on the body,
// case-insensitive only. Recalled messages, group events and messages the user deleted for
// themselves are left out. Newest first. Callers check membership.

export const MAX_SEARCH_QUERY_LENGTH = 100;
export const MAX_SEARCH_RESULTS = 30;

// the query from ?q=, or null when it is empty or too long
export const searchQueryOf = (request: Request) => {
  const query = (new URL(request.url).searchParams.get("q") ?? "").trim();
  return query && query.length <= MAX_SEARCH_QUERY_LENGTH ? query : null;
};

export const searchMessages = async (
  conversationIds: string[],
  userId: string,
  query: string,
  select: Prisma.MessageSelect
) => {
  if (conversationIds.length === 0) {
    return [];
  }
  const inConversations = { conversationId: { in: conversationIds } };
  // the ones the user deleted for themselves: looked up with a positive `has` and left out by id
  // (`NOT: { has }` would also drop every message without the list, see hiddenMessageIds)
  const hidden = await prisma.message.findMany({
    where: { ...inConversations, hiddenForIds: { has: userId } },
    select: { id: true },
  });
  return prisma.message.findMany({
    where: {
      ...inConversations,
      ...(hidden.length > 0 && { id: { notIn: hidden.map((message) => message.id) } }),
      AND: [
        NOT_RECALLED,
        NOT_SYSTEM,
        {
          OR: [
            { searchText: { contains: normalizeSearch(query) } },
            { searchText: { isSet: false }, body: { contains: query, mode: "insensitive" } },
          ],
        },
      ],
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: MAX_SEARCH_RESULTS,
    select,
  });
};
