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
import { Mention, splitMentions } from "@/app/libs/mentions";

import axios from "axios";
import { toast } from "react-hot-toast";

import Avatar from "@/app/components/Avatar";
import { useOpenImage } from "./ImageViewer";
import { FileCard, LinkPreviewCard, VoicePlayer } from "./MessageAttachment";
import { Menu, MenuButton, MenuItem, MenuItems } from "@headlessui/react";
import usePins from "@/app/hooks/usePins";
import { deleteForMe, togglePin } from "./messageCommands";
import { ReactionChips, ReactionPicker } from "./MessageReactions";
import { ReplyQuote, messageElementId } from "./MessageReply";
import useComposer from "@/app/hooks/useComposer";
import useSystemText from "@/app/hooks/useSystemText";
import {
  canEditMessage,
  canForwardMessage,
  canPinMessage,
  canReactToMessage,
  canRecallMessage,
  canReplyToMessage,
} from "@/app/libs/message-actions";
import {
  HiArrowUturnLeft,
  HiArrowUturnRight,
  HiEllipsisHorizontal,
  HiEllipsisVertical,
  HiPencil,
  HiTrash,
} from "react-icons/hi2";
import { useForward } from "./ForwardDialog";
import MessageMenuSheet from "./MessageMenuSheet";
import useMessageGestures, { SWIPE_TRIGGER } from "./useMessageGestures";

interface MessageBoxProps {
  data: FullMessageType;
  isLast?: boolean;
  // false: continues the previous message of the same sender (no avatar / name / time)
  showHeader?: boolean;
  // a message from the outbox that the server hasn't confirmed yet (app/hooks/useOutbox.ts)
  pending?: { status: "sending" | "failed"; tooFast?: boolean; onRetry: () => void; onDiscard: () => void };
}

// The body with http(s) links clickable (opened in a new tab, without the referrer) and
// @mentions highlighted (the reader's own more strongly).
const MessageText: React.FC<{
  text: string;
  isOwn: boolean;
  mentions?: Mention[];
  myEmail?: string | null;
}> = ({ text, isOwn, mentions = [], myEmail }) => (
  <>
    {splitLinks(text).map((segment, i) =>
      segment.type === "text" ? (
        <Fragment key={i}>
          {splitMentions(segment.value, mentions).map((part, j) =>
            part.type === "mention" ? (
              <span
                key={j}
                className={clsx(
                  "font-semibold",
                  part.mention?.email && part.mention.email === myEmail
                    ? isOwn
                      ? "rounded bg-white/25 px-0.5"
                      : "rounded bg-sky-500/20 px-0.5 text-sky-700 dark:text-sky-300"
                    : isOwn
                      ? "text-white"
                      : "text-sky-600 dark:text-sky-400"
                )}>
                {part.value}
              </span>
            ) : (
              <Fragment key={j}>{part.value}</Fragment>
            )
          )}
        </Fragment>
      ) : segment.type === "link" ? (
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

// Hover actions next to the bubble (pointer devices only; touch screens use the "…" menu):
// reply, and for the sender edit (text, for a while) and recall (two clicks: the second confirms).
const MessageActions: React.FC<{ message: FullMessageType; isOwn: boolean }> = ({
  message,
  isOwn,
}) => {
  const t = useTranslations("chat");
  const { startReply, startEdit } = useComposer();
  const [confirmRecall, setConfirmRecall] = useState(false);
  // the sender's id is the message's own when it is the user's (no session id needed)
  const myId = isOwn ? message.senderId : "";

  const recall = () => {
    if (!confirmRecall) {
      setConfirmRecall(true);
      setTimeout(() => setConfirmRecall(false), 3000);
      return;
    }
    setConfirmRecall(false);
    axios
      .delete(`/api/messages/${message.id}`)
      .catch(() => toast.error(t("recall_failed")));
  };

  const button =
    "rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground";
  return (
    <div
      className={clsx(
        "flex shrink-0 items-center transition group-hover:opacity-100 focus-within:opacity-100 [@media(hover:none)]:hidden",
        confirmRecall ? "opacity-100" : "opacity-0"
      )}>
      {canReplyToMessage(message) && (
        <button
          type="button"
          onClick={() => startReply(message)}
          aria-label={t("reply")}
          title={t("reply")}
          className={button}>
          <HiArrowUturnLeft size={16} aria-hidden />
        </button>
      )}
      {canForwardMessage(message) && (
        <button
          type="button"
          onClick={() => useForward.getState().open(message)}
          aria-label={t("forward")}
          title={t("forward")}
          className={button}>
          <HiArrowUturnRight size={16} aria-hidden />
        </button>
      )}
      {canEditMessage(message, myId) && (
        <button
          type="button"
          onClick={() => startEdit(message)}
          aria-label={t("edit")}
          title={t("edit")}
          className={button}>
          <HiPencil size={16} aria-hidden />
        </button>
      )}
      <MoreMenu message={message} />
      {canRecallMessage(message, myId) && (
        <button
          type="button"
          onClick={recall}
          aria-label={confirmRecall ? t("recall_confirm") : t("recall")}
          title={confirmRecall ? t("recall_confirm") : t("recall")}
          className={clsx(button, confirmRecall && "bg-rose-500 text-white hover:bg-rose-600 hover:text-white")}>
          {confirmRecall ? (
            <span className="px-1 text-xs font-medium">{t("recall_confirm")}</span>
          ) : (
            <HiTrash size={16} aria-hidden />
          )}
        </button>
      )}
    </div>
  );
};

// Pin / unpin and "delete for me" (pointer devices; the touch menu has them too).
const MoreMenu: React.FC<{ message: FullMessageType }> = ({ message }) => {
  const t = useTranslations("chat");
  const pinned = usePins((state) => state.ids.includes(message.id));
  const item = "block w-full px-3 py-1.5 text-left text-sm text-foreground data-[focus]:bg-muted";
  return (
    <Menu>
      <MenuButton
        aria-label={t("more")}
        title={t("more")}
        className="rounded-full p-1 text-muted-foreground transition hover:bg-muted hover:text-foreground focus:outline-none data-[open]:bg-muted">
        <HiEllipsisVertical size={16} aria-hidden />
      </MenuButton>
      <MenuItems
        anchor={{ to: "top", gap: 4 }}
        className="z-40 min-w-40 rounded-lg border bg-background py-1 shadow-lg focus:outline-none">
        {(canPinMessage(message) || pinned) && (
          <MenuItem>
            <button type="button" className={item} onClick={() => togglePin(message.id, !pinned, t)}>
              {pinned ? t("unpin") : t("pin")}
            </button>
          </MenuItem>
        )}
        <MenuItem>
          <button
            type="button"
            className={clsx(item, "text-rose-500")}
            onClick={() => deleteForMe(message.id, t("delete_for_me_failed"))}>
            {t("delete_for_me")}
          </button>
        </MenuItem>
      </MenuItems>
    </Menu>
  );
};

// at most this many faces under the last message, then "+N"
const SEEN_AVATARS_MAX = 5;

// Read receipts: small faces of who has seen the message (names on hover / for screen readers).
const SeenAvatars: React.FC<{ users: FullMessageType["seen"] }> = ({ users }) => {
  const t = useTranslations("chat");
  const label = t("seen_by", { names: users.map((user) => user.name).join(", ") });
  const extra = users.length - SEEN_AVATARS_MAX;
  return (
    <div className="flex items-center gap-0.5 self-end" title={label} aria-label={label} role="img">
      {users.slice(0, SEEN_AVATARS_MAX).map((user) => (
        <Image
          key={user.id}
          src={user.image || "/images/placeholder.jpg"}
          alt=""
          width={16}
          height={16}
          className="h-4 w-4 rounded-full object-cover"
        />
      ))}
      {extra > 0 && <span className="pl-0.5 text-[10px] text-muted-foreground">+{extra}</span>}
    </div>
  );
};

const MessageBox: React.FC<MessageBoxProps> = ({ data, isLast, showHeader = true, pending }) => {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const session = useSession();
  const openImage = useOpenImage();
  const [menuOpen, setMenuOpen] = useState(false);
  // touch screens: a grouped message's time, shown by a tap (there is no hover title)
  const [timeShown, setTimeShown] = useState(false);

  const myEmail = session.data?.user?.email;
  const isOwn = myEmail === data?.sender?.email;

  const recalled = !!data.deletedAt;
  // none on a recalled message or a call (calls from before the rule may still have some)
  const reactions = canReactToMessage(data) ? (data.reactions ?? []) : [];
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

  // nothing to react to (or act on) before the server has the message, once recalled, or
  // on a call (no reply / edit / recall / reaction there).
  // Touch screens: hold for the menu, swipe towards the middle to reply.
  const actionable = !pending && canReactToMessage(data);
  const { startReply } = useComposer();
  const swipeDirection = isOwn ? -1 : 1;
  const { pull, handlers: gestures } = useMessageGestures({
    direction: swipeDirection,
    onLongPress: actionable ? () => setMenuOpen(true) : undefined,
    onSwipe: actionable && canReplyToMessage(data) ? () => startReply(data) : undefined,
    onTap: showHeader ? undefined : () => setTimeShown((shown) => !shown),
  });

  const systemText = useSystemText();

  // who has seen it besides its sender and the user (shown under the chat's last message)
  const seenBy = (data.seen || []).filter(
    (user) => user.email !== data?.sender?.email && user.email !== myEmail
  );

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

  const message = recalled
    ? // a placeholder, not a bubble of content: outlined, muted, italic
      "w-fit max-w-full rounded-2xl border px-3 py-2 text-sm italic text-muted-foreground"
    : jumbo
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

  // a group event: one centered line, no avatar, bubble or actions
  if (data.systemType) {
    return (
      <div id={messageElementId(data.id)} className="flex justify-center px-4 py-3">
        <p className="max-w-[85%] text-center text-xs text-muted-foreground">
          {systemText(data)}
        </p>
      </div>
    );
  }

  return (
    <div id={messageElementId(data.id)} className={clsx(container, "rounded-lg")}>
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
        {data.forwarded && !recalled && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground">
            <HiArrowUturnRight size={12} aria-hidden />
            {t("chat.forwarded")}
          </div>
        )}
        {data.replyTo && !recalled && <ReplyQuote reply={data.replyTo} isOwn={isOwn} />}
        <div className="relative max-w-full">
          {/* revealed behind the bubble while it is swiped */}
          {pull > 0 && (
            <div
              aria-hidden
              className={clsx(
                "absolute top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-muted text-muted-foreground",
                isOwn ? "right-0" : "left-0"
              )}
              style={{
                opacity: Math.min(pull / SWIPE_TRIGGER, 1),
                transform: `translateY(-50%) scale(${pull >= SWIPE_TRIGGER ? 1.15 : 0.6 + 0.4 * (pull / SWIPE_TRIGGER)})`,
              }}>
              <HiArrowUturnLeft size={16} />
            </div>
          )}
        <div
          className={clsx(
            "group relative flex max-w-full touch-pan-y items-center gap-1",
            isOwn && "flex-row-reverse",
            pull === 0 && "transition-transform duration-200"
          )}
          style={pull > 0 ? { transform: `translateX(${pull * swipeDirection}px)` } : undefined}
          {...gestures}
          // the time of a grouped message, on hover
          title={showHeader ? undefined : format(new Date(data.createdAt), "p", { locale: dateLocale })}>
          {/* touch screens: no text selection / iOS callout on a hold (the menu has "Copy") */}
          <div className={clsx(message, "[@media(hover:none)]:select-none [@media(hover:none)]:[-webkit-touch-callout:none]")}>
            {recalled && t("chat.recalled")}
            {data.image && (
              <button
                type="button"
                onClick={() => openImage?.(data.image!)}
                aria-label={t("common.image")}
                className="block overflow-hidden">
                <Image
                  alt={t("common.image")}
                  height="288"
                  width="288"
                  src={data.image}
                  className="object-cover transition hover:scale-105"
                />
              </button>
            )}
            {data.attachment?.kind === "file" && (
              <FileCard
                attachment={data.attachment}
                isOwn={isOwn}
                // an outbox copy has no server id yet
                messageId={pending ? undefined : data.id}
              />
            )}
            {data.linkPreview && !recalled && (
              <LinkPreviewCard preview={data.linkPreview} isOwn={isOwn} />
            )}
            {data.attachment?.kind === "voice" && (
              <VoicePlayer attachment={data.attachment} isOwn={isOwn} />
            )}
            {/* keeps line breaks; anywhere: long URLs / words wrap instead of overflowing */}
            {data.body && (
              <div className="whitespace-pre-wrap [overflow-wrap:anywhere]">
                <MessageText
                  text={data.body}
                  isOwn={isOwn && !jumbo}
                  mentions={data.mentions}
                  myEmail={myEmail}
                />
              </div>
            )}
            {data.isCall && <CallSummary call={data} isOwn={isOwn} />}
          </div>
          {actionable && <ReactionPicker onReact={react} mine={myReaction} />}
          {actionable && <MessageActions message={data} isOwn={isOwn} />}
          {actionable && (
            <button
              type="button"
              onClick={() => setMenuOpen(true)}
              aria-label={t("chat.more_actions")}
              aria-haspopup="dialog"
              className="hidden shrink-0 rounded-full p-1 text-muted-foreground active:bg-muted [@media(hover:none)]:block">
              <HiEllipsisHorizontal size={18} aria-hidden />
            </button>
          )}
        </div>
        </div>
        {actionable && (
          <MessageMenuSheet
            open={menuOpen}
            onClose={() => setMenuOpen(false)}
            message={data}
            isOwn={isOwn}
            onReact={react}
            mine={myReaction}
          />
        )}
        {timeShown && !showHeader && (
          <time
            dateTime={new Date(data.createdAt).toISOString()}
            className="text-xs font-light text-muted-foreground">
            {format(new Date(data.createdAt), "p", { locale: dateLocale })}
          </time>
        )}
        {data.editedAt && !recalled && (
          <div className="text-xs font-light text-muted-foreground">{t("chat.edited")}</div>
        )}
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
        {isLast && seenBy.length > 0 && <SeenAvatars users={seenBy} />}
      </div>
    </div>
  );
};

export default MessageBox;
