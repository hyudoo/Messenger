import { createTranslator, hasLocale } from "next-intl";

import vi from "@/i18n/messages/vi.json";
import en from "@/i18n/messages/en.json";
import { routing } from "@/i18n/routing";
import { sendPush } from "@/app/libs/web-push";

const MESSAGES = { vi, en } as const;
// push payloads are limited to about 4 KB
const MAX_BODY_LENGTH = 180;

const truncate = (text: string) =>
  text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH - 1)}…` : text;

interface NewMessage {
  conversation: { id: string; name: string | null; isGroup: boolean | null };
  sender: { id: string; name: string | null; image: string | null };
  body: string | null;
  image: string | null;
  recipientIds: string[];
}

// The Web Push for a new message (not calls: they ring in the open app). Same text as the in-tab
// notification (app/components/MessageNotifications.tsx): the group's name as the title and
// "Sender: text" in groups, the sender's name and the text in 1:1 chats.
export const pushNewMessage = ({ conversation, sender, body, image, recipientIds }: NewMessage) =>
  sendPush(
    recipientIds,
    (requested) => {
      const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
      const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "notifications" });
      const senderName = sender.name ?? "";
      const text = image ? t("image") : (body ?? "");
      const path = `/conversations/${conversation.id}`;
      return {
        title: conversation.isGroup && conversation.name ? conversation.name : senderName,
        body: truncate(conversation.isGroup ? `${senderName}: ${text}` : text),
        icon: sender.image || "/images/placeholder.jpg",
        tag: `conversation-${conversation.id}`,
        url: `/${locale}${path}`,
        path,
      };
    },
    { topic: conversation.id }
  );
