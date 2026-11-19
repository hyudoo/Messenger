"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useLocale, useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { getSocket } from "@/app/libs/socket-client";
import { getNotificationState, syncPush } from "@/app/libs/notifications";
import { isPushActive } from "@/app/libs/push-client";
import { ConversationUpdate } from "@/app/types";

// Desktop notifications for new messages from someone else, if the user turned them on (settings
// modal or the inbox prompt). Mounted in the [locale] layout, next to IncomingCall, so it works on
// every page. Calls are left out: they ring through IncomingCall.
// - Web Push (public/sw.js) notifies even with every tab closed. This keeps the subscription in
//   step on each load (and in the current language), and opens the conversation when one of its
//   notifications is clicked.
// - Without push (unsupported, not configured, not subscribed yet) this tab shows them itself,
//   while the window isn't focused: hidden, minimised or behind another app.
const MessageNotifications = () => {
  const t = useTranslations("notifications");
  const locale = useLocale();
  const router = useRouter();
  const { data, status } = useSession();
  const myEmail = data?.user?.email;

  // the latest values for the handlers, which are registered once
  const latest = useRef({ myEmail, t, router });
  useLayoutEffect(() => {
    latest.current = { myEmail, t, router };
  });

  // subscribe / refresh Web Push for the signed-in user (and the language it writes in)
  useEffect(() => {
    if (status === "authenticated") {
      void syncPush(locale);
    }
  }, [status, locale]);

  // a push notification was clicked while a tab is open: sw.js focuses it and asks it to navigate
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const container = navigator.serviceWorker;
    const onMessage = (event: MessageEvent) => {
      const message = event.data as { type?: string; path?: string } | null;
      if (message?.type === "notification:open" && message.path?.startsWith("/")) {
        latest.current.router.push(message.path);
      }
    };
    container.addEventListener("message", onMessage);
    container.startMessages();
    return () => container.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const socket = getSocket();

    const handler = (update: ConversationUpdate) => {
      const { myEmail: me, t: translate, router: navigate } = latest.current;
      const message = update.messages?.[update.messages.length - 1];
      if (
        !update.lastMessageAt || // not a new message (seen, members)
        !message ||
        message.isCall ||
        message.systemType || // group events aren't worth a notification
        update.muted || // the user muted the conversation
        message.sender?.email === me ||
        getNotificationState() !== "on" ||
        isPushActive() // the service worker shows it
      ) {
        return;
      }
      // the user is looking at the app: the message (or the inbox badge) shows itself
      if (document.visibilityState === "visible" && document.hasFocus()) {
        return;
      }

      const sender = message.sender?.name ?? "";
      const content = message.image
        ? translate("image")
        : message.attachment?.kind === "voice"
          ? translate("voice")
          : message.attachment
            ? translate("file", { name: message.attachment.name })
            : message.gif
              ? translate(message.gif.kind === "sticker" ? "sticker" : "gif")
              : (message.body ?? "");
      const text = update.mentioned ? translate("mentioned_you", { text: content }) : content;
      const notification = new Notification(
        update.isGroup && update.name ? update.name : sender,
        {
          body: update.isGroup ? `${sender}: ${text}` : text,
          icon: message.sender?.image || "/images/placeholder.jpg",
          // one notification per conversation, replaced by the next message
          tag: `conversation-${update.id}`,
        }
      );
      notification.onclick = () => {
        window.focus();
        navigate.push(`/conversations/${update.id}`);
        notification.close();
      };
    };

    socket.on("conversation:update", handler);
    return () => {
      socket.off("conversation:update", handler);
    };
  }, []);

  return null;
};

export default MessageNotifications;
