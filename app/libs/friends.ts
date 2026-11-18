import { Prisma } from "@prisma/client";

import prisma from "./prismadb";
import { isBlockedBetween } from "./blocks";

// Friends (the contacts page): User.friendIds, kept on both sides and private (omitted from user
// rows, read with a `select`), and FriendRequest rows waiting for their recipient. Being friends
// puts people on each other's contacts page and in their presence (with the people they share a
// conversation with; server/socket.ts contactsOf). Chatting doesn't need it.

// at most this many requests waiting from one sender (spam)
export const MAX_PENDING_REQUESTS = 100;

export type Relation = "friend" | "incoming" | "outgoing" | "none";

export const friendIdsOf = async (userId: string) => {
  const row = await prisma.user.findUnique({ where: { id: userId }, select: { friendIds: true } });
  return row?.friendIds ?? [];
};

// How the user stands with each of these people (the search results' buttons).
export const relationsWith = async (userId: string, otherIds: string[]) => {
  const [friends, requests] = await Promise.all([
    friendIdsOf(userId),
    otherIds.length > 0
      ? prisma.friendRequest.findMany({
          where: {
            OR: [
              { fromId: userId, toId: { in: otherIds } },
              { toId: userId, fromId: { in: otherIds } },
            ],
          },
          select: { fromId: true, toId: true },
        })
      : Promise.resolve([]),
  ]);
  const relations = new Map<string, Relation>(otherIds.map((id) => [id, "none"]));
  requests.forEach((request) =>
    request.fromId === userId
      ? relations.set(request.toId, "outgoing")
      : relations.set(request.fromId, "incoming")
  );
  friends.forEach((id) => relations.has(id) && relations.set(id, "friend"));
  return relations;
};

// adds `id` to a user's friendIds once (read, then set: Prisma has no "add to set" on MongoDB)
const addFriendId = async (userId: string, id: string) => {
  const friends = await friendIdsOf(userId);
  if (!friends.includes(id)) {
    await prisma.user.update({
      where: { id: userId },
      data: { friendIds: { set: [...friends, id] } },
      select: { id: true },
    });
  }
};

const removeFriendId = async (userId: string, id: string) => {
  const friends = await friendIdsOf(userId);
  if (friends.includes(id)) {
    await prisma.user.update({
      where: { id: userId },
      data: { friendIds: { set: friends.filter((friend) => friend !== id) } },
      select: { id: true },
    });
  }
};

// Both become friends, and any request between them (either way) is done.
export const makeFriends = async (aId: string, bId: string) => {
  await addFriendId(aId, bId);
  await addFriendId(bId, aId);
  await prisma.friendRequest.deleteMany({
    where: { OR: [{ fromId: aId, toId: bId }, { fromId: bId, toId: aId }] },
  });
};

export const unfriend = async (aId: string, bId: string) => {
  await removeFriendId(aId, bId);
  await removeFriendId(bId, aId);
};

export type SendResult = "requested" | "pending" | "accepted" | "friends" | "blocked" | "too_many";

// A request from `fromId` to `toId` (callers check that `toId` exists and isn't the sender).
// Someone who already asked us: accepted instead (both are friends at once).
export const sendFriendRequest = async (fromId: string, toId: string): Promise<SendResult> => {
  if (await isBlockedBetween(fromId, toId)) {
    return "blocked";
  }
  if ((await friendIdsOf(fromId)).includes(toId)) {
    return "friends";
  }
  const [theirs, mine] = await Promise.all([
    prisma.friendRequest.findUnique({ where: { fromId_toId: { fromId: toId, toId: fromId } } }),
    prisma.friendRequest.findUnique({ where: { fromId_toId: { fromId, toId } } }),
  ]);
  if (theirs) {
    await makeFriends(fromId, toId);
    return "accepted";
  }
  if (mine) {
    return "pending";
  }
  if ((await prisma.friendRequest.count({ where: { fromId } })) >= MAX_PENDING_REQUESTS) {
    return "too_many";
  }
  try {
    await prisma.friendRequest.create({ data: { fromId, toId }, select: { id: true } });
  } catch (error) {
    // the same request made twice at once (the unique pair)
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "pending";
    }
    throw error;
  }
  return "requested";
};
