import prisma from "@/app/libs/prismadb";
import { NOT_RECALLED, REPLY_PREVIEW_SELECT } from "@/app/libs/message-include";

// Previews of the pinned messages, in pin order (latest first); recalled ones are left out.
export const findPinnedMessages = async (ids: string[]) => {
  if (ids.length === 0) {
    return [];
  }
  const messages = await prisma.message.findMany({
    where: { id: { in: ids }, ...NOT_RECALLED },
    select: { ...REPLY_PREVIEW_SELECT, createdAt: true },
  });
  const byId = new Map(messages.map((message) => [message.id, message]));
  return ids.map((id) => byId.get(id)).filter((message) => !!message);
};

export type PinnedMessage = Awaited<ReturnType<typeof findPinnedMessages>>[number];
