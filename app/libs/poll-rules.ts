// Group polls: what a poll may hold and how votes add up. Shared by the routes (POST
// /api/conversations/[id]/polls, /api/polls/[id]/votes, /close) and the UI (PollComposer, PollCard),
// so no server-only imports here.
import { isGroupAdmin } from "./conversation-permissions";

type ConversationRoles = Parameters<typeof isGroupAdmin>[0];

export const MIN_POLL_OPTIONS = 2;
export const MAX_POLL_OPTIONS = 10;
export const MAX_POLL_QUESTION = 300;
export const MAX_POLL_OPTION = 100;

export type PollView = {
  id: string;
  question: string;
  options: { id: string; text: string }[];
  multiple: boolean;
  closedAt: Date | string | null;
  votes: { optionId: string; userId: string }[];
};

const collapse = (value: unknown) =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim() : "";

// A new poll from the request body: the question and 2–10 distinct options (case-insensitive),
// each trimmed and within its length. null when it doesn't hold up.
export const parseNewPoll = (
  body: unknown
): { question: string; options: string[]; multiple: boolean } | null => {
  const input = (body ?? {}) as { question?: unknown; options?: unknown; multiple?: unknown };
  const question = collapse(input.question);
  if (!question || question.length > MAX_POLL_QUESTION || !Array.isArray(input.options)) {
    return null;
  }
  const seen = new Set<string>();
  const options: string[] = [];
  for (const raw of input.options) {
    const text = collapse(raw);
    if (!text) {
      continue;
    }
    if (text.length > MAX_POLL_OPTION || seen.has(text.toLowerCase())) {
      return null;
    }
    seen.add(text.toLowerCase());
    options.push(text);
  }
  if (options.length < MIN_POLL_OPTIONS || options.length > MAX_POLL_OPTIONS) {
    return null;
  }
  return { question, options, multiple: input.multiple === true };
};

// The options a voter picked, checked against the poll: known ids, no repeats, at most one unless
// the poll takes several. An empty list takes the vote back. null when invalid.
export const parseVote = (poll: Pick<PollView, "options" | "multiple">, optionIds: unknown) => {
  if (!Array.isArray(optionIds)) {
    return null;
  }
  const known = new Set(poll.options.map((option) => option.id));
  const picked = Array.from(new Set(optionIds));
  if (!picked.every((id): id is string => typeof id === "string" && known.has(id))) {
    return null;
  }
  return !poll.multiple && picked.length > 1 ? null : picked;
};

// Votes per option, the people who voted, and the user's own picks.
export const tallyPoll = (poll: PollView, userId?: string | null) => {
  const counts = new Map(poll.options.map((option) => [option.id, [] as string[]]));
  poll.votes.forEach((vote) => counts.get(vote.optionId)?.push(vote.userId));
  const voters = new Set(poll.votes.map((vote) => vote.userId));
  const mine = new Set(
    poll.votes.filter((vote) => !!userId && vote.userId === userId).map((vote) => vote.optionId)
  );
  return { counts, voters: voters.size, mine };
};

// What a click on an option does to the user's picks: a single-choice poll picks that one (again:
// takes the vote back), a multiple-choice one toggles it.
export const nextPicks = (
  poll: Pick<PollView, "multiple">,
  mine: Set<string>,
  optionId: string
) => {
  if (!poll.multiple) {
    return mine.has(optionId) ? [] : [optionId];
  }
  return mine.has(optionId)
    ? Array.from(mine).filter((id) => id !== optionId)
    : [...Array.from(mine), optionId];
};

// Who may close a poll (no more votes): whoever asked it, or a group admin.
export const canClosePoll = (
  conversation: ConversationRoles,
  poll: { senderId: string },
  userId: string
) => poll.senderId === userId || isGroupAdmin(conversation, userId);
