"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { format, isToday } from "date-fns";
import { useSession } from "next-auth/react";
import clsx from "clsx";

import { Link } from "@/i18n/navigation";
import Avatar from "@/app/components/Avatar";
import useOtherUser from "@/app/hooks/useOtherUser";
import AvatarGroup from "@/app/components/AvatarGroup";
import { FullConversationType } from "@/app/types";
import useDateLocale from "@/app/hooks/useDateLocale";
import { callDurationSeconds, formatCallDuration } from "@/app/libs/call";
import { formatUnread } from "@/app/libs/unread";

interface ConversationBoxProps {
  data: FullConversationType;
  selected?: boolean;
}

const ConversationBox: React.FC<ConversationBoxProps> = ({
  data,
  selected,
}) => {
  const t = useTranslations("conversations");
  const dateLocale = useDateLocale();
  const otherUser = useOtherUser(data);
  const session = useSession();

  const lastMessage = useMemo(() => {
    const messages = data.messages || [];
    return messages[messages.length - 1];
  }, [data.messages]);

  const userEmail = session.data?.user?.email;

  const hasSeen = useMemo(() => {
    if (!lastMessage || !userEmail) {
      return false;
    }
    return (lastMessage.seen || []).some((user) => user.email === userEmail);
  }, [userEmail, lastMessage]);

  // the server's count (inbox load / resync), kept up to date by ConversationList
  const unread = data.unreadCount ?? (hasSeen || !lastMessage ? 0 : 1);

  const lastMessageText = useMemo(() => {
    if (lastMessage?.isCall) {
      // older calls have no callType: video
      const kind = lastMessage.callType ?? "video";
      if (lastMessage.callStatus === "declined") {
        return t("last_call_declined", { kind });
      }
      if (lastMessage.callStatus === "missed") {
        return t("last_call_missed", { kind });
      }
      const duration =
        lastMessage.callStatus === "ended" ? callDurationSeconds(lastMessage) : null;
      return duration !== null
        ? t("last_call_ended", { kind, duration: formatCallDuration(duration) })
        : t("last_call", { kind });
    }

    const text = lastMessage?.deletedAt
      ? t("last_recalled")
      : lastMessage?.image
        ? t("last_image")
        : lastMessage?.body;
    if (!text) {
      return t("no_messages");
    }
    // who wrote it: "You: …" for one's own, "Name: …" in groups (in a 1:1 chat it's obvious)
    const fromMe = !!userEmail && lastMessage?.sender?.email === userEmail;
    if (fromMe) {
      return t("last_from", { name: t("you"), text });
    }
    if (data.isGroup && lastMessage?.sender?.name) {
      return t("last_from", { name: lastMessage.sender.name, text });
    }
    return text;
  }, [lastMessage, t, userEmail, data.isGroup]);

  const title = data.name || otherUser.name;

  return (
    <Link
      href={`/conversations/${data.id}`}
      aria-current={selected ? "page" : undefined}
      className={clsx(
        `
        w-full
        relative
        flex
        items-center
        space-x-3
        p-3
        hover:bg-muted
        rounded-lg
        transition
        cursor-pointer
        focus:outline-none
        focus-visible:ring-2
        focus-visible:ring-sky-500
      `,
        selected ? "bg-muted" : "bg-background"
      )}>
      {data.isGroup ? (
        <AvatarGroup users={data.users} />
      ) : (
        <Avatar user={otherUser} />
      )}
      <div className="min-w-0 flex-1">
        <div className="flex justify-between items-center gap-2 mb-1">
          <p
            className={clsx(
              "text-md truncate text-foreground",
              unread > 0 ? "font-semibold" : "font-medium"
            )}>
            {title}
          </p>
          {lastMessage?.createdAt && (
            <p
              className={clsx(
                "shrink-0 text-xs",
                unread > 0 ? "font-medium text-sky-500" : "font-light text-muted-foreground"
              )}>
              {/* time for today's messages, date for older ones */}
              {isToday(new Date(lastMessage.createdAt))
                ? format(new Date(lastMessage.createdAt), "p", { locale: dateLocale })
                : format(new Date(lastMessage.createdAt), "P", { locale: dateLocale })}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          <p
            className={clsx(
              "min-w-0 flex-1 truncate text-sm",
              unread > 0 ? "text-foreground font-medium" : "text-muted-foreground"
            )}>
            {lastMessageText}
          </p>
          {unread > 0 && (
            <span
              className="shrink-0 rounded-full bg-sky-500 px-1.5 py-0.5 text-xs font-semibold leading-none text-white"
              aria-label={t("unread", { count: unread })}>
              {formatUnread(unread)}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
};

export default ConversationBox;
