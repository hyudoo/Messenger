// One-off, after friends were added (note 45): makes the two people of every 1:1 chat friends when
// both have written in it (a real exchange, not one-sided messages), unless either blocked the
// other. Without it the contacts page starts empty for everyone. Safe to run again: pairs already
// friends are skipped.
//   npx tsx scripts/backfill-friends-from-chats.ts           (dry run: only counts)
//   npx tsx scripts/backfill-friends-from-chats.ts --apply   (writes)
// Nobody is notified; open tabs see the change on their next page load.
import prisma from "../app/libs/prismadb";
import { isBlockedBetween } from "../app/libs/blocks";
import { friendIdsOf, makeFriends } from "../app/libs/friends";

const apply = process.argv.includes("--apply");

const hasWritten = async (conversationId: string, senderId: string) =>
  !!(await prisma.message.findFirst({
    // a person's message, not a group event (1:1 chats have none, but older data may)
    where: { conversationId, senderId, OR: [{ systemType: null }, { systemType: { isSet: false } }] },
    select: { id: true },
  }));

const main = async () => {
  // all conversations, filtered here: `isGroup` may be null or missing on older documents
  const conversations = await prisma.conversation.findMany({
    select: { id: true, isGroup: true, userIds: true },
  });
  const pairs = conversations.filter(
    (conversation) => !conversation.isGroup && new Set(conversation.userIds).size === 2
  );
  const counts = { chats: pairs.length, friendsAlready: 0, oneSided: 0, blocked: 0, made: 0 };

  for (const conversation of pairs) {
    const [a, b] = Array.from(new Set(conversation.userIds));
    if ((await friendIdsOf(a)).includes(b) && (await friendIdsOf(b)).includes(a)) {
      counts.friendsAlready += 1;
      continue;
    }
    if (!(await hasWritten(conversation.id, a)) || !(await hasWritten(conversation.id, b))) {
      counts.oneSided += 1;
      continue;
    }
    if (await isBlockedBetween(a, b)) {
      counts.blocked += 1;
      continue;
    }
    if (apply) {
      await makeFriends(a, b);
    }
    counts.made += 1;
  }

  console.log(
    `${apply ? "made friends" : "would make friends (dry run, add --apply)"}: ${counts.made}` +
      ` | 1:1 chats ${counts.chats}, already friends ${counts.friendsAlready},` +
      ` one-sided ${counts.oneSided}, blocked ${counts.blocked}`
  );
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
