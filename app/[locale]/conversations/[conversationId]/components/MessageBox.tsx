"use client";

import clsx from "clsx";
import Image from "next/image";
import { Fragment, useState } from "react";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { FullMessageType } from "@/app/types";
import { useTranslations } from "next-intl";
import useDateLocale from "@/app/hooks/useDateLocale";
import {
  HiPhoneArrowUpRight,
  HiPhoneArrowDownLeft,
  HiPhoneXMark,
} from "react-icons/hi2";

import { callDurationSeconds, formatCallDuration } from "@/app/libs/call";
import { JUMBO_EMOJI_MAX, countEmojiOnly } from "@/app/libs/emoji";
import { splitLinks } from "@/app/libs/linkify";

import axios from "axios";
import { toast } from "react-hot-toast";

import Avatar from "@/app/components/Avatar";
import ImageModal from "./ImageModal";
import { ReactionChips, ReactionPicker } from "./MessageReactions";

interface MessageBoxProps {
  data: FullMessageType;
  isLast?: boolean;
  // false: continues the previous message of the same sender (no avatar / name / time)
  showHeader?: boolean;
  // a message from the outbox that the server hasn't confirmed yet (app/hooks/useOutbox.ts)
  pending?: { status: "sending" | "failed"; tooFast?: boolean; onRetry: () => void; onDiscard: () => void };
}

// The body with http(s) links clickable (opened in a new tab, without the referrer).
const MessageText: React.FC<{ text: string; isOwn: boolean }> = ({ text, isOwn }) => (
  <>
    {splitLinks(text).map((segment, i) =>
      segment.type === "link" ? (
        <a
          key={i}
          href={segment.value}
          target="_blank"
          rel="noopener noreferrer nofollow"
          className={clsx("underline underline-offset-2", isOwn ? "text-white" : "text-sky-600 dark:text-sky-400")}>
          {segment.value}
        </a>
      ) : (
        <Fragment key={i}>{segment.value}</Fragment>
      )
    )}
  </>
);

// A call message: direction, how it went (callStatus, kept by server/call-log.ts) and, once
// answered and hung up, its duration. Calls from before callStatus existed show the direction only.
const CallSummary: React.FC<{ call: FullMessageType; isOwn: boolean }> = ({ call, isOwn }) => {
  const t = useTranslations("chat");
  const failed = call.callStatus === "declined" || call.callStatus === "missed";
  const duration = call.callStatus === "ended" ? callDurationSeconds(call) : null;

  const kind = call.callType ?? "video"; // older calls: video
  let label = isOwn ? t("outgoing_call", { kind }) : t("incoming_call", { kind });
  if (call.callStatus === "declined") {
    label = isOwn ? t("call_declined_by_other") : t("call_declined_by_you");
  } else if (call.callStatus === "missed") {
    label = isOwn ? t("call_no_answer") : t("call_missed");
  }

  const Icon = failed ? HiPhoneXMark : isOwn ? HiPhoneArrowUpRight : HiPhoneArrowDownLeft;

  return (
    <div className="flex items-center gap-3">
      <div
        className={clsx(
          "p-1 rounded-full",
          failed ? "bg-rose-500" : isOwn ? "bg-sky-600" : "bg-muted-foreground"
        )}>
        <Icon size={10} className="text-white" aria-hidden />
      </div>
      <div className="flex flex-col">
        <span>{label}</span>
        {duration !== null && (
          <span className={clsx("text-xs", isOwn ? "text-sky-100" : "text-muted-foreground")}>
            {t("call_duration", { duration: formatCallDuration(duration) })}
          </span>
        )}
      </div>
    </div>
  );
};

const MessageBox: React.FC<MessageBoxProps> = ({ data, isLast, showHeader = true, pending }) => {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const session = useSession();
  const [imageModalOpen, setImageModalOpen] = useState(false);

  const myEmail = session.data?.user?.email;
  const isOwn = myEmail === data?.sender?.email;

  const reactions = data.reactions ?? [];
  const myReaction = reactions.find((reaction) => myEmail && reaction.user.email === myEmail)?.emoji;
  // the conversation room sends the updated message back (messages:update)
  const react = (emoji: string) => {
    axios
      .post(`/api/messages/${data.id}/reactions`, { emoji })
      .catch((error) =>
        toast.error(
          error?.response?.status === 429 ? t("chat.send_too_fast") : t("reactions.failed")
        )
      );
  };

  const seenList = (data.seen || [])
    .filter((user) => user.email !== data?.sender?.email)
    .map((user) => user.name)
    .join(", ");

  // grouped messages sit closer together, under the first one's header
  const container = clsx("flex gap-3 px-4", showHeader ? "pt-4 pb-1" : "py-0.5", isOwn && "justify-end");
  // keeps the avatar's width when it is hidden, so grouped bubbles line up
  const avatar = clsx("shrink-0", isOwn && "order-2", !showHeader && "invisible h-0");
  // min-w-0 lets a long message shrink and wrap instead of widening the row
  const body = clsx("flex min-w-0 max-w-[80%] flex-col gap-2 sm:max-w-md", isOwn && "items-end");
  // only a few emoji: shown large, without a bubble
  const emojiCount =
    !data.image && !data.isCall && data.body ? countEmojiOnly(data.body) : 0;
  const jumbo = emojiCount > 0 && emojiCount <= JUMBO_EMOJI_MAX;

  const message = jumbo
    ? clsx(
        "w-fit select-text leading-tight",
        emojiCount === 1 ? "text-5xl" : "text-4xl"
      )
    : clsx(
        "text-sm w-fit max-w-full overflow-hidden transition-opacity",
        pending?.status === "sending" && "opacity-60",
        pending?.status === "failed" && "ring-2 ring-rose-500",
        isOwn ? "bg-sky-500 text-white" : "bg-muted",
        // rounded-2xl, not rounded-full: a pill shape breaks once a message wraps
        data.image ? "rounded-md p-0" : "rounded-2xl py-2 px-3"
      );

  return (
    <div className={container}>
      <div className={avatar}>
        <Avatar user={data.sender} />
      </div>
      <div className={body}>
        {showHeader && (
          <div className="flex items-center gap-1">
            <div className="text-sm text-muted-foreground">{data.sender.name}</div>
            <div className="text-xs text-muted-foreground">
              {format(new Date(data.createdAt), "p", { locale: dateLocale })}
            </div>
          </div>
        )}
        <div
          className={clsx("group flex max-w-full items-center gap-1", isOwn && "flex-row-reverse")}
          // the time of a grouped message, on hover
          title={showHeader ? undefined : format(new Date(data.createdAt), "p", { locale: dateLocale })}>
          <div className={message}>
            {data.image && (
              <ImageModal
                src={data.image}
                isOpen={imageModalOpen}
                onClose={() => setImageModalOpen(false)}
              />
            )}
            {data.image && (
              <Image
                alt={t("common.image")}
                height="288"
                width="288"
                onClick={() => setImageModalOpen(true)}
                src={data.image}
                className="
                object-cover
                cursor-pointer
                hover:scale-110
                transition
                translate"
              />
            )}
            {/* keeps line breaks; anywhere: long URLs / words wrap instead of overflowing */}
            {data.body && (
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                <MessageText text={data.body} isOwn={isOwn && !jumbo} />
              </div>
            )}
            {data.isCall && <CallSummary call={data} isOwn={isOwn} />}
          </div>
          {/* nothing to react to before the server has the message */}
          {!pending && <ReactionPicker onReact={react} mine={myReaction} />}
        </div>
        {pending?.status === "sending" && (
          <div className="text-xs font-light text-muted-foreground">{t("chat.sending")}</div>
        )}
        {pending?.status === "failed" && (
          <div className="flex items-center gap-2 text-xs" role="alert">
            <span className="text-rose-500">
              {pending.tooFast ? t("chat.send_too_fast") : t("chat.send_failed")}
            </span>
            <button type="button" onClick={pending.onRetry} className="font-medium text-sky-500 hover:underline">
              {t("chat.retry")}
            </button>
            <button type="button" onClick={pending.onDiscard} className="text-muted-foreground hover:underline">
              {t("chat.discard")}
            </button>
          </div>
        )}
        {reactions.length > 0 && (
          <ReactionChips reactions={reactions} myEmail={myEmail} onReact={react} />
        )}
        {isLast && isOwn && seenList.length > 0 && (
          <div
            className="
           text-xs
           font-light
           text-muted-foreground">
            {t("chat.seen_by", { names: seenList })}
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageBox;
