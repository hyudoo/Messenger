"use client";

import clsx from "clsx";
import { useState } from "react";
import { useTranslations } from "next-intl";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { HiOutlineFaceSmile, HiPlus } from "react-icons/hi2";

import { EmojiPickerPanel } from "@/app/components/EmojiPicker";
import { MessageReaction } from "@/app/types";
import BottomSheet from "./BottomSheet";

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

// touch screens have no hover title to tell who reacted
const isTouchScreen = () =>
  typeof window !== "undefined" && window.matchMedia("(hover: none)").matches;

// One chip per emoji (count, who, mine highlighted) under the bubble. A click adds that
// emoji, or removes it when it is already mine; on a touch screen it shows who reacted.
export const ReactionChips: React.FC<ReactionChipsProps> = ({
  reactions,
  myEmail,
  onReact,
}) => {
  const t = useTranslations("reactions");
  // the "who reacted" sheet: the emoji whose tab it opens on (kept while it closes), and how
  // many times it was opened (a new list each time, starting on that tab)
  const [details, setDetails] = useState({ open: false, emoji: "", opened: 0 });
  const showDetails = (emoji: string) =>
    setDetails((previous) => ({ open: true, emoji, opened: previous.opened + 1 }));

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
          onClick={() => (isTouchScreen() ? showDetails(emoji) : onReact(emoji))}
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
      <ReactionsSheet
        key={details.opened}
        open={details.open}
        initialEmoji={details.emoji}
        onClose={() => setDetails((previous) => ({ ...previous, open: false }))}
        reactions={reactions}
        myEmail={myEmail}
        onReact={onReact}
      />
    </div>
  );
};

interface ReactionsSheetProps {
  open: boolean;
  // the tab shown first
  initialEmoji: string;
  onClose: () => void;
  reactions: MessageReaction[];
  myEmail?: string | null;
  onReact: (emoji: string) => void;
}

// Who reacted (touch screens), by emoji: "All" and one tab per emoji. One's own row
// removes the reaction.
// Keyed by the caller per opening, so the tab starts on the chip's emoji.
const ReactionsSheet: React.FC<ReactionsSheetProps> = ({
  open,
  initialEmoji,
  onClose,
  reactions,
  myEmail,
  onReact,
}) => {
  const t = useTranslations("reactions");
  // null: all
  const [tab, setTab] = useState<string | null>(initialEmoji);

  const counts = new Map<string, number>();
  reactions.forEach((reaction) =>
    counts.set(reaction.emoji, (counts.get(reaction.emoji) ?? 0) + 1)
  );
  const shown = tab ? reactions.filter((reaction) => reaction.emoji === tab) : reactions;

  const tabClass = (active: boolean) =>
    clsx(
      "flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-sm transition",
      active ? "bg-sky-500/15 font-medium text-sky-600 dark:text-sky-400" : "text-muted-foreground"
    );

  return (
    <BottomSheet open={open} onClose={onClose} title={t("title")}>
      <div className="mb-2 flex gap-1 overflow-x-auto pb-1" role="tablist">
        <button
          type="button"
          role="tab"
          aria-selected={tab === null}
          onClick={() => setTab(null)}
          className={tabClass(tab === null)}>
          {t("all", { count: reactions.length })}
        </button>
        {Array.from(counts, ([emoji, count]) => (
          <button
            key={emoji}
            type="button"
            role="tab"
            aria-selected={tab === emoji}
            onClick={() => setTab(emoji)}
            className={tabClass(tab === emoji)}>
            <span className="text-base leading-none">{emoji}</span>
            <span className="tabular-nums">{count}</span>
          </button>
        ))}
      </div>
      <ul className="flex flex-col">
        {shown.map((reaction) => {
          const mine = !!myEmail && reaction.user.email === myEmail;
          const row = (
            <>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-foreground">
                  {mine ? t("you") : reaction.user.name}
                </span>
                {mine && (
                  <span className="block text-xs text-muted-foreground">{t("tap_to_remove")}</span>
                )}
              </span>
              <span className="text-2xl leading-none">{reaction.emoji}</span>
            </>
          );
          return (
            <li key={reaction.userId}>
              {mine ? (
                <button
                  type="button"
                  onClick={() => {
                    onReact(reaction.emoji);
                    onClose();
                  }}
                  className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition active:bg-muted">
                  {row}
                </button>
              ) : (
                <div className="flex items-center gap-3 px-3 py-2.5">{row}</div>
              )}
            </li>
          );
        })}
      </ul>
    </BottomSheet>
  );
};
