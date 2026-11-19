import prisma from "./prismadb";
import { deleteConversation } from "./conversation-delete";
import { removeGroupMember } from "./conversation-members";
import { forgetSessionVersion } from "./session-version";
import {
  emitToConversation,
  notifyContactsChanged,
  notifySessionsRevoked,
} from "./socket-server";
import { cleanUpUploads } from "./upload-cleanup";
import { logError } from "./log";

// ids per raw update / `in` filter
const CHUNK = 1000;

const chunks = <T>(items: T[]) =>
  Array.from({ length: Math.ceil(items.length / CHUNK) }, (_, i) => items.slice(i * CHUNK, (i + 1) * CHUNK));

const oid = (id: string) => ({ $oid: id });

// Prisma has no $pull for scalar lists: one raw update over a collection.
const pullEverywhere = (collection: string, query: object, pull: object) =>
  prisma.$runCommandRaw({ update: collection, updates: [{ q: query, u: { $pull: pull }, multi: true }] });

// Deletes an account and what is only theirs (DELETE /api/account; callers check who asks):
// - 1:1 chats go entirely (deleteConversation, also their files); groups lose them as a member,
//   silently (the owner's role passes on as when leaving; the last member deletes the group);
// - their messages left in groups go (with their reactions / polls, unpinned, replies to them lose
//   the quote, their files from S3 once nothing else uses them; the open chats drop them);
// - their id leaves everyone else's friends / blocks / reads / admins / join requests / nicknames;
// - the user row goes, and with it (cascade) their logins (Account), push subscriptions, friend
//   requests, reactions, poll votes, reset / verification links;
// - every session ends at once (a deleted user's token fails isSessionCurrent) and their sockets
//   close; their contacts' pages refresh.
// Returns false when there is no such user.
export const deleteAccount = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, image: true, friendIds: true },
  });
  if (!user) {
    return false;
  }

  // people waiting on a request from / to them (their counts change once the requests cascade)
  const requests = await prisma.friendRequest.findMany({
    where: { OR: [{ fromId: userId }, { toId: userId }] },
    select: { from: { select: { email: true } }, to: { select: { email: true } } },
  });

  // their conversations
  const conversations = await prisma.conversation.findMany({
    where: { userIds: { has: userId } },
    include: { users: true },
  });
  const contacts = new Set<string | null>(conversations.flatMap((item) => item.users.map((member) => member.email)));
  for (const conversation of conversations) {
    if (conversation.isGroup) {
      await removeGroupMember(conversation, userId, userId, { announce: false });
    } else {
      await deleteConversation(conversation);
    }
  }

  // their messages left in groups (a 1:1 chat's went with it)
  const messages = await prisma.message.findMany({
    where: { senderId: userId },
    select: { id: true, conversationId: true, image: true, attachment: true },
  });
  const messageIds = messages.map((message) => message.id);
  for (const ids of chunks(messageIds)) {
    // replies keep their text without the quote (the relation is NoAction: it would block the delete)
    await prisma.message.updateMany({ where: { replyToId: { in: ids } }, data: { replyToId: null } });
    await pullEverywhere("Conversation", { pinnedMessageIds: { $in: ids.map(oid) } }, {
      pinnedMessageIds: { $in: ids.map(oid) },
    });
    await pullEverywhere("User", { seenMessageIds: { $in: ids.map(oid) } }, {
      seenMessageIds: { $in: ids.map(oid) },
    });
    await prisma.reaction.deleteMany({ where: { messageId: { in: ids } } });
    await prisma.poll.deleteMany({ where: { messageId: { in: ids } } });
    await prisma.message.deleteMany({ where: { id: { in: ids } } });
  }

  // their id in other people's rows
  const me = oid(userId);
  await pullEverywhere("User", { $or: [{ friendIds: me }, { blockedUserIds: me }] }, {
    friendIds: me,
    blockedUserIds: me,
  });
  await pullEverywhere("Message", { $or: [{ seenIds: me }, { privateSeenIds: me }, { hiddenForIds: me }] }, {
    seenIds: me,
    privateSeenIds: me,
    hiddenForIds: me,
  });
  await pullEverywhere(
    "Conversation",
    { $or: [{ adminIds: me }, { joinRequestIds: me }, { "nicknames.userId": me }] },
    { adminIds: me, joinRequestIds: me, nicknames: { userId: me } }
  );

  // the row and everything that cascades with it
  await prisma.user.delete({ where: { id: userId } });

  forgetSessionVersion(userId);
  if (user.email) {
    notifySessionsRevoked(userId, user.email);
  }

  // after the rows: cleanUpUploads keeps files something else still uses (e.g. a forwarded copy)
  cleanUpUploads([user.image, ...messages.flatMap((message) => [message.image, message.attachment?.url])]);

  // the open group chats drop their messages
  const byConversation = new Map<string, string[]>();
  messages.forEach((message) =>
    byConversation.set(message.conversationId, [...(byConversation.get(message.conversationId) ?? []), message.id])
  );
  byConversation.forEach((ids, conversationId) =>
    ids.forEach((messageId) => emitToConversation(conversationId, "messages:hide", { conversationId, messageId }))
  );

  // friends and people they shared chats with: friend lists, presence, request counts
  const friends = user.friendIds.length
    ? await prisma.user.findMany({ where: { id: { in: user.friendIds } }, select: { email: true } })
    : [];
  friends.forEach((friend) => contacts.add(friend.email));
  requests.forEach((request) => {
    contacts.add(request.from.email);
    contacts.add(request.to.email);
  });
  contacts.delete(user.email);
  try {
    notifyContactsChanged(Array.from(contacts), true);
  } catch (error) {
    logError("account_delete_notify", error);
  }
  return true;
};
