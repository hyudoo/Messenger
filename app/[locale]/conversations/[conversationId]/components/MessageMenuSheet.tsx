"use client";

import clsx from "clsx";
import axios from "axios";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useTranslations } from "next-intl";
import { format } from "date-fns";
import {
  HiArrowUturnLeft,
  HiArrowUturnRight,
  HiOutlineDocumentDuplicate,
  HiPencil,
  HiPlus,
  HiTrash,
} from "react-icons/hi2";

import { EmojiPickerPanel } from "@/app/components/EmojiPicker";
import useComposer from "@/app/hooks/useComposer";
import useDateLocale from "@/app/hooks/useDateLocale";
import {
  canEditMessage,
  canForwardMessage,
  canRecallMessage,
  canReplyToMessage,
} from "@/app/libs/message-actions";
import { useForward } from "./ForwardDialog";
import { FullMessageType } from "@/app/types";
import { QUICK_REACTIONS } from "./MessageReactions";
import { MessageSnippet } from "./MessageReply";
import BottomSheet from "./BottomSheet";

interface MessageMenuSheetProps {
  open: boolean;
  onClose: () => void;
  message: FullMessageType;
  isOwn: boolean;
  onReact: (emoji: string) => void;
  // the caller's current reaction, highlighted (picking it again removes it)
  mine?: string;
}

// The message menu on touch screens (the "…" button or a long press), a bottom sheet:
// when it was sent, quick reactions (+ the full picker), then reply / copy / edit / recall.
const MessageMenuSheet: React.FC<MessageMenuSheetProps> = ({
  open,
  onClose,
  message,
  isOwn,
  onReact,
  mine,
}) => {
  const t = useTranslations();
  const dateLocale = useDateLocale();
  const { startReply, startEdit } = useComposer();
  const [fullPicker, setFullPicker] = useState(false);
  const [confirmRecall, setConfirmRecall] = useState(false);
  // the sender's id is the message's own when it is the user's (no session id needed)
  const myId = isOwn ? message.senderId : "";

  const close = () => {
    onClose();
    // after the closing slide, so the content doesn't jump while it leaves
    setTimeout(() => {
      setFullPicker(false);
      setConfirmRecall(false);
    }, 200);
  };

  const react = (emoji: string) => {
    onReact(emoji);
    close();
  };

  const copy = () => {
    close();
    navigator.clipboard
      ?.writeText(message.body ?? "")
      .then(() => toast.success(t("chat.copied")))
      .catch(() => toast.error(t("chat.copy_failed")));
  };

  const recall = () => {
    if (!confirmRecall) {
      setConfirmRecall(true);
      return;
    }
    close();
    axios
      .delete(`/api/messages/${message.id}`)
      .catch(() => toast.error(t("chat.recall_failed")));
  };

  const item =
    "flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left text-[15px] transition active:bg-muted";

  return (
    <BottomSheet
      open={open}
      onClose={close}
      title={
        <>
          <div className="truncate">
            {message.sender?.name}: <MessageSnippet message={message} />
          </div>
          <time dateTime={new Date(message.createdAt).toISOString()}>
            {format(new Date(message.createdAt), "Pp", { locale: dateLocale })}
          </time>
        </>
      }>
      {fullPicker ? (
        <div className="flex justify-center pb-1">
          <EmojiPickerPanel onSelect={react} />
        </div>
      ) : (
        <div className="mb-2 flex items-center justify-between rounded-full bg-muted/60 p-1">
          {QUICK_REACTIONS.map((emoji) => (
            <button
              key={emoji}
              type="button"
              aria-label={t("reactions.react_with", { emoji })}
              aria-pressed={mine === emoji}
              onClick={() => react(emoji)}
              className={clsx(
                "h-11 w-11 rounded-full text-[28px] leading-none transition active:scale-125",
                mine === emoji && "bg-sky-500/20"
              )}>
              {emoji}
            </button>
          ))}
          <button
            type="button"
            aria-label={t("reactions.more")}
            onClick={() => setFullPicker(true)}
            className="flex h-11 w-11 items-center justify-center rounded-full bg-background text-muted-foreground">
            <HiPlus size={20} aria-hidden />
          </button>
        </div>
      )}

      {!fullPicker && (
        <div className="flex flex-col">
          {canReplyToMessage(message) && (
            <button
              type="button"
              className={item}
              onClick={() => {
                close();
                startReply(message);
              }}>
              <HiArrowUturnLeft size={20} aria-hidden className="text-muted-foreground" />
              {t("chat.reply")}
            </button>
          )}
          {canForwardMessage(message) && (
            <button
              type="button"
              className={item}
              onClick={() => {
                close();
                useForward.getState().open(message);
              }}>
              <HiArrowUturnRight size={20} aria-hidden className="text-muted-foreground" />
              {t("chat.forward")}
            </button>
          )}
          {message.body && (
            <button type="button" className={item} onClick={copy}>
              <HiOutlineDocumentDuplicate size={20} aria-hidden className="text-muted-foreground" />
              {t("chat.copy")}
            </button>
          )}
          {canEditMessage(message, myId) && (
            <button
              type="button"
              className={item}
              onClick={() => {
                close();
                startEdit(message);
              }}>
              <HiPencil size={20} aria-hidden className="text-muted-foreground" />
              {t("chat.edit")}
            </button>
          )}
          {canRecallMessage(message, myId) && (
            <button
              type="button"
              className={clsx(item, "text-rose-500", confirmRecall && "bg-rose-500/10")}
              onClick={recall}>
              <HiTrash size={20} aria-hidden />
              {confirmRecall ? t("chat.recall_tap_again") : t("chat.recall")}
            </button>
          )}
        </div>
      )}
    </BottomSheet>
  );
};

export default MessageMenuSheet;
