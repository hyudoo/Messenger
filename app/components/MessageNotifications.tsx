"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useTranslations } from "next-intl";

import { useRouter } from "@/i18n/navigation";
import { getSocket } from "@/app/libs/socket-client";
import { getNotificationState } from "@/app/libs/notifications";
import { ConversationUpdate } from "@/app/types";

// Shows a desktop notification for a new message from someone else while this tab is hidden, if
// the user turned notifications on in the settings. Mounted in the [locale] layout, next to
// IncomingCall, so it works on every page. Calls are left out: they ring through IncomingCall.
// Clicking a notification focuses the tab and opens the conversation.
const MessageNotifications = () => {
  const t = useTranslations("notifications");
  const router = useRouter();
  const myEmail = useSession().data?.user?.email;

  // the latest values for the socket handler, which is registered once
  const latest = useRef({ myEmail, t, router });
  useLayoutEffect(() => {
    latest.current = { myEmail, t, router };
  });

  useEffect(() => {
    const socket = getSocket();

    const handler = (update: ConversationUpdate) => {
      const { myEmail: me, t: translate, router: navigate } = latest.current;
      const message = update.messages?.[update.messages.length - 1];
      if (
        !update.lastMessageAt || // not a new message (seen, members)
        !message ||
        message.isCall ||
        message.sender?.email === me ||
        getNotificationState() !== "on"
      ) {
        return;
      }
      // a visible tab shows the message (or the inbox badge) itself
      if (document.visibilityState === "visible") {
        return;
      }

      const sender = message.sender?.name ?? "";
      const text = message.image ? translate("image") : (message.body ?? "");
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
