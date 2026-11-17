import prisma from "@/app/libs/prismadb";
import { deleteUploadedObjects } from "@/app/libs/s3";
import { logError } from "./log";

// Removes uploaded files that nothing points at any more (no user avatar, no message image or
// attachment). Call it after the rows that used them are updated or deleted.
// Runs in the background: a failed cleanup only leaves an orphan file behind.
export const cleanUpUploads = (urls: (string | null | undefined)[]) => {
  const candidates = Array.from(new Set(urls.filter((url): url is string => !!url)));
  if (candidates.length === 0) {
    return;
  }

  (async () => {
    const [usedByMessages, usedByAttachments, usedByUsers] = await Promise.all([
      prisma.message.findMany({
        where: { image: { in: candidates } },
        select: { image: true },
      }),
      prisma.message.findMany({
        where: { attachment: { is: { url: { in: candidates } } } },
        select: { attachment: true },
      }),
      prisma.user.findMany({
        where: { image: { in: candidates } },
        select: { image: true },
      }),
    ]);
    const stillUsed = new Set([
      ...usedByMessages.map((row) => row.image),
      ...usedByAttachments.map((row) => row.attachment?.url),
      ...usedByUsers.map((row) => row.image),
    ]);
    await deleteUploadedObjects(candidates.filter((url) => !stillUsed.has(url)));
  })().catch((error) => logError("upload_cleanup", error));
};
