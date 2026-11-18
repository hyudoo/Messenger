"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import { HiArrowUturnLeft } from "react-icons/hi2";

import { ReplyPreview } from "@/app/types";
import useMessageJump from "@/app/hooks/useMessageJump";
import { scrollIntoViewSettled } from "@/app/libs/message-window";

type Snippetable = Pick<ReplyPreview, "body" | "image" | "isCall" | "deletedAt"> & {
  attachment?: ReplyPreview["attachment"];
};

// One line standing for a message: its text, or what it was (image, call, recalled).
export const MessageSnippet: React.FC<{ message: Snippetable }> = ({ message }) => {
  const t = useTranslations("chat");
  if (message.deletedAt) {
    return <span className="italic">{t("recalled")}</span>;
  }
  if (message.image) {
    return <>{t("reply_image")}</>;
  }
  if (message.isCall) {
    return <>{t("reply_call")}</>;
  }
  if (message.attachment) {
    return (
      <>
        {message.attachment.kind === "voice"
          ? t("reply_voice")
          : t("reply_file", { name: message.attachment.name })}
      </>
    );
  }
  return <>{message.body}</>;
};

// The ids of rendered messages (Body) are message-<id>; a reply's quote asks Body to show the
// original (useMessageJump), which loads older pages first when it isn't loaded.
export const messageElementId = (id: string) => `message-${id}`;

// Scrolls a rendered message into the middle and flashes it; false when it isn't rendered.
export const flashMessage = (id: string) => {
  const element = document.getElementById(messageElementId(id));
  if (!element) {
    return false;
  }
  // not smooth: the rows on the way may be skipped ones (content-visibility) whose real height
  // only shows once rendered, so the position is corrected on the next frame
  scrollIntoViewSettled(element, { block: "center" });
  element.classList.add("message-flash");
  setTimeout(() => element.classList.remove("message-flash"), 1600);
  return true;
};

// Above a reply: who and what it answers. A button, so the original can be reached by keyboard.
export const ReplyQuote: React.FC<{ reply: ReplyPreview; isOwn: boolean }> = ({
  reply,
  isOwn,
}) => {
  const t = useTranslations("chat");
  return (
    <button
      type="button"
      onClick={() => useMessageJump.getState().request(reply.id)}
      title={t("reply_jump")}
      className={clsx(
        "flex max-w-full items-center gap-1.5 rounded-xl bg-muted/60 px-3 py-1.5 text-left text-xs text-muted-foreground hover:bg-muted",
        isOwn && "self-end"
      )}>
      <HiArrowUturnLeft size={12} aria-hidden className="shrink-0" />
      <span className="shrink-0 font-medium">{reply.sender?.name}:</span>
      <span className="truncate">
        <MessageSnippet message={reply} />
      </span>
    </button>
  );
};
