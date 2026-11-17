import prisma from "./prismadb";
import { MESSAGE_INCLUDE } from "./message-include";
import { emitToConversation } from "./socket-server";
import { firstLink, getLinkPreview } from "./link-preview";
import { logError } from "./log";

// Fetches the preview of the first link in a message's text in the background and, when there
// is one, saves it and sends the message again (messages:update). Sending never waits for it.
// `previousUrl`: after an edit, nothing happens while the first link is the same.
export const attachLinkPreview = (
  message: { id: string; body: string | null; conversationId: string },
  previousUrl?: string | null
) => {
  const url = firstLink(message.body);
  if (url === (previousUrl ?? null) && previousUrl !== undefined) {
    return;
  }
  void (async () => {
    const preview = url ? await getLinkPreview(url) : null;
    if (!preview && previousUrl === undefined) {
      return; // a new message without a preview: nothing to change
    }
    const updated = await prisma.message.update({
      where: { id: message.id },
      data: { linkPreview: preview ? { set: preview } : { unset: true } },
      include: MESSAGE_INCLUDE,
    });
    // recalled in the meantime: keep it blank
    if (!updated.deletedAt) {
      emitToConversation(message.conversationId, "messages:update", updated);
    }
  })().catch((error) => logError("link_preview", error));
};
