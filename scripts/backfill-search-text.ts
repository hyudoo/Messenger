// Fills Message.searchText (the body folded for search, app/libs/search.ts) for messages saved
// before it existed. Safe to run again: it only touches messages with a body and no searchText.
//   npx tsx scripts/backfill-search-text.ts
import prisma from "../app/libs/prismadb";
import { searchTextOf } from "../app/libs/search";

const BATCH = 500;

const main = async () => {
  let done = 0;
  for (;;) {
    const messages = await prisma.message.findMany({
      where: { body: { not: null }, searchText: { isSet: false } },
      select: { id: true, body: true },
      take: BATCH,
    });
    if (messages.length === 0) {
      break;
    }
    await prisma.$transaction(
      messages.map((message) =>
        prisma.message.update({
          where: { id: message.id },
          // "" for a body with nothing to search, so the message isn't picked up again
          data: { searchText: searchTextOf(message.body) ?? "" },
          select: { id: true },
        })
      )
    );
    done += messages.length;
    console.log(`searchText: ${done} messages`);
  }
  console.log(`done (${done} messages)`);
};

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
