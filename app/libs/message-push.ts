import { createTranslator, hasLocale } from "next-intl";

import vi from "@/i18n/messages/vi.json";
import en from "@/i18n/messages/en.json";
import { routing } from "@/i18n/routing";
import { CALL_RING_TIMEOUT_MS } from "@/app/libs/call";
import { sendPush } from "@/app/libs/web-push";

const MESSAGES = { vi, en } as const;
// push payloads are limited to about 4 KB
const MAX_BODY_LENGTH = 180;

const truncate = (text: string) =>
  text.length > MAX_BODY_LENGTH ? `${text.slice(0, MAX_BODY_LENGTH - 1)}…` : text;

const translator = (locale: keyof typeof MESSAGES) =>
  createTranslator({ locale, messages: MESSAGES[locale], namespace: "notifications" });
type Translate = ReturnType<typeof translator>;

interface ConversationPush {
  conversation: { id: string; name: string | null; isGroup: boolean | null };
  sender: { name: string | null; image: string | null };
  recipientIds: string[];
}

// The common shape, matching the in-tab notification (app/components/MessageNotifications.tsx): the
// group's name as the title and "Sender: text" in groups, the sender's name and the text in 1:1
// chats. Clicking opens the conversation (a call still ringing then rings in the app too).
const pushToConversation = (
  { conversation, sender, recipientIds }: ConversationPush,
  text: (t: Translate) => string,
  options: { tag: string; topic: string; ttlSeconds?: number; call?: { expiresAt?: number } }
) =>
  sendPush(
    recipientIds,
    (requested) => {
      const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
      const senderName = sender.name ?? "";
      const body = text(translator(locale));
      const path = `/conversations/${conversation.id}`;
      return {
        title: conversation.isGroup && conversation.name ? conversation.name : senderName,
        body: truncate(conversation.isGroup ? `${senderName}: ${body}` : body),
        icon: sender.image || "/images/placeholder.jpg",
        tag: options.tag,
        url: `/${locale}${path}`,
        path,
        ...(options.call && {
          // a ringing call stays up (closed by sw.js when the ringing ends)
          requireInteraction: !!options.call.expiresAt,
          ...(options.call.expiresAt && { expiresAt: options.call.expiresAt }),
        }),
      };
    },
    { topic: options.topic, ttlSeconds: options.ttlSeconds }
  );

// one notification per call: the missed call replaces the ringing one; the topic also replaces
// a ringing push still queued at the push service. Hex ids keep it within the 32-character limit.
const callTag = (conversationId: string) => `call-${conversationId}`;
const callTopic = (conversationId: string) => `call${conversationId}`;

// A new message (not calls).
export const pushNewMessage = ({
  body,
  image,
  ...push
}: ConversationPush & { body: string | null; image: string | null }) =>
  pushToConversation(push, (t) => (image ? t("image") : (body ?? "")), {
    tag: `conversation-${push.conversation.id}`,
    topic: push.conversation.id,
  });

// A call starting: only worth delivering while it rings.
export const pushIncomingCall = ({
  callType,
  startedAt,
  ...push
}: ConversationPush & { callType: string | null; startedAt: Date }) => {
  const expiresAt = startedAt.getTime() + CALL_RING_TIMEOUT_MS;
  return pushToConversation(
    push,
    (t) => t("incoming_call", { kind: callType === "audio" ? "audio" : "video" }),
    {
      tag: callTag(push.conversation.id),
      topic: callTopic(push.conversation.id),
      ttlSeconds: Math.ceil(CALL_RING_TIMEOUT_MS / 1000),
      call: { expiresAt },
    }
  );
};

// A call nobody answered (server/call-log.ts, ringing -> missed).
export const pushMissedCall = ({
  callType,
  ...push
}: ConversationPush & { callType: string | null }) =>
  pushToConversation(
    push,
    (t) => t("missed_call", { kind: callType === "audio" ? "audio" : "video" }),
    {
      tag: callTag(push.conversation.id),
      topic: callTopic(push.conversation.id),
      call: {},
    }
  );
