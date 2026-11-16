"use client";

import { useCallback, useMemo } from "react";
import { useRouter } from "@/i18n/navigation";
import { useTranslations } from "next-intl";
import { format, isToday } from "date-fns";
import { useSession } from "next-auth/react";
import clsx from "clsx";

import Avatar from "@/app/components/Avatar";
import useOtherUser from "@/app/hooks/useOtherUser";
import AvatarGroup from "@/app/components/AvatarGroup";
import { FullConversationType } from "@/app/types";
import useDateLocale from "@/app/hooks/useDateLocale";
import { callDurationSeconds, formatCallDuration } from "@/app/libs/call";

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
  const router = useRouter();

  const handleClick = useCallback(() => {
    router.push(`/conversations/${data.id}`);
  }, [data, router]);

  const lastMessage = useMemo(() => {
    const messages = data.messages || [];
    return messages[messages.length - 1];
  }, [data.messages]);

  const userEmail = useMemo(
    () => session.data?.user?.email,
    [session.data?.user?.email]
  );

  const hasSeen = useMemo(() => {
    if (!lastMessage) {
      return false;
    }
    const seenArray = lastMessage.seen || [];

    if (!userEmail) {
      return false;
    }
    return seenArray.filter((user) => user.email === userEmail).length !== 0;
  }, [userEmail, lastMessage]);

  const lastMessageText = useMemo(() => {
    if (lastMessage?.image) {
      return t("last_image");
    }

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

    if (lastMessage?.body) {
      return lastMessage?.body;
    }
    return t("no_messages");
  }, [lastMessage, t]);

  return (
    <div
      onClick={handleClick}
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
      `,
        selected ? "bg-muted" : "bg-background"
      )}>
      {data.isGroup ? (
        <AvatarGroup users={data.users} />
      ) : (
        <Avatar user={otherUser} />
      )}
      <div className="min-w-0 flex-1">
        <div className="focus:outline-none">
          <span className="absolute inset-0" aria-hidden="true" />
          <div className="flex justify-between items-center mb-1">
            <p className="text-md font-medium text-foreground">
              {data.name || otherUser.name}
            </p>
            {lastMessage?.createdAt && (
              <p
                className="text-xs
                text-muted-foreground
                font-light">
                {/* time for today's messages, date for older ones */}
                {isToday(new Date(lastMessage.createdAt))
                  ? format(new Date(lastMessage.createdAt), "p", { locale: dateLocale })
                  : format(new Date(lastMessage.createdAt), "P", { locale: dateLocale })}
              </p>
            )}
          </div>
          <p
            className={clsx(
              `
          truncate 
          text-sm`,
              hasSeen ? "text-muted-foreground" : "text-foreground font-medium"
            )}>
            {lastMessageText}
          </p>
        </div>
      </div>
    </div>
  );
};

export default ConversationBox;
