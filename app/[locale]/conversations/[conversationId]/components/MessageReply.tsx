"use client";

import clsx from "clsx";
import { useTranslations } from "next-intl";
import { HiArrowUturnLeft } from "react-icons/hi2";

import { ReplyPreview } from "@/app/types";

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

// The ids of rendered messages (Body) are message-<id>; a reply's quote scrolls to the original
// and flashes it, when it is loaded (older pages may not be).
export const messageElementId = (id: string) => `message-${id}`;

const jumpTo = (id: string) => {
  const element = document.getElementById(messageElementId(id));
  if (!element) {
    return;
  }
  element.scrollIntoView({ behavior: "smooth", block: "center" });
  element.classList.add("message-flash");
  setTimeout(() => element.classList.remove("message-flash"), 1600);
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
      onClick={() => jumpTo(reply.id)}
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
