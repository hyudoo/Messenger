"use client";

import clsx from "clsx";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { HiOutlineFaceSmile, HiPlus } from "react-icons/hi2";

import { EmojiPickerPanel } from "@/app/components/EmojiPicker";
import { MessageReaction } from "@/app/types";

// the row offered first; "+" opens the full picker
export const QUICK_REACTIONS = ["❤️", "😆", "😮", "😢", "😠", "👍"];

interface ReactionPickerProps {
  onReact: (emoji: string) => void;
  // the caller's current reaction, highlighted (picking it again removes it)
  mine?: string;
}

// The smiley next to a message bubble: shown on hover; touch screens use the "…" menu instead.
export const ReactionPicker: React.FC<ReactionPickerProps> = ({ onReact, mine }) => {
  const t = useTranslations("reactions");
  const [full, setFull] = useState(false);

  return (
    <Popover className="relative flex [@media(hover:none)]:hidden">
      {({ close }) => {
        const pick = (emoji: string) => {
          onReact(emoji);
          close();
        };
        return (
          <>
            <PopoverButton
              aria-label={t("add")}
              title={t("add")}
              onClick={() => setFull(false)}
              className="
                rounded-full
                p-1
                text-muted-foreground
                opacity-0
                transition
                hover:bg-muted
                hover:text-foreground
                focus:outline-none
                focus-visible:opacity-100
                focus-visible:ring-2
                focus-visible:ring-sky-500
                group-hover:opacity-100
                data-[open]:opacity-100
">
              <HiOutlineFaceSmile size={18} />
            </PopoverButton>
            <PopoverPanel anchor={{ to: "top", gap: 8 }} className="z-50">
              {full ? (
                <div className="rounded-lg shadow-xl">
                  <EmojiPickerPanel onSelect={pick} />
                </div>
              ) : (
                <div className="flex items-center gap-0.5 rounded-full border bg-background p-1 shadow-lg">
                  {QUICK_REACTIONS.map((emoji) => (
                    <button
                      key={emoji}
                      type="button"
                      aria-label={t("react_with", { emoji })}
                      aria-pressed={mine === emoji}
                      onClick={() => pick(emoji)}
                      className={clsx(
                        "h-9 w-9 rounded-full text-2xl leading-none transition hover:scale-125 hover:bg-muted",
                        mine === emoji && "bg-sky-500/15"
                      )}>
                      {emoji}
                    </button>
                  ))}
                  <button
                    type="button"
                    aria-label={t("more")}
                    title={t("more")}
                    onClick={() => setFull(true)}
                    className="flex h-9 w-9 items-center justify-center rounded-full bg-muted text-muted-foreground transition hover:text-foreground">
                    <HiPlus size={18} />
                  </button>
                </div>
              )}
            </PopoverPanel>
          </>
        );
      }}
    </Popover>
  );
};

interface ReactionChipsProps {
  reactions: MessageReaction[];
  myEmail?: string | null;
  onReact: (emoji: string) => void;
}

// One chip per emoji (count, who, mine highlighted) under the bubble; a click
// adds that emoji, or removes it when it is already mine.
export const ReactionChips: React.FC<ReactionChipsProps> = ({
  reactions,
  myEmail,
  onReact,
}) => {
  const t = useTranslations("reactions");

  const groups = new Map<string, { names: string[]; mine: boolean }>();
  reactions.forEach((reaction) => {
    const group = groups.get(reaction.emoji) ?? { names: [], mine: false };
    const mine = !!myEmail && reaction.user.email === myEmail;
    group.names.push(mine ? t("you") : reaction.user.name ?? "");
    group.mine ||= mine;
    groups.set(reaction.emoji, group);
  });

  return (
    <div className="flex flex-wrap gap-1">
      {Array.from(groups, ([emoji, { names, mine }]) => (
        <button
          key={emoji}
          type="button"
          title={t("reacted_by", { emoji, names: names.join(", ") })}
          aria-label={t("reacted_by", { emoji, names: names.join(", ") })}
          aria-pressed={mine}
          onClick={() => onReact(emoji)}
          className={clsx(
            "flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-xs shadow-sm transition",
            mine
              ? "border-sky-500 bg-sky-500/15"
              : "bg-background hover:bg-muted"
          )}>
          <span className="text-sm leading-none">{emoji}</span>
          {names.length > 1 && (
            <span className="tabular-nums text-muted-foreground">{names.length}</span>
          )}
        </button>
      ))}
    </div>
  );
};
