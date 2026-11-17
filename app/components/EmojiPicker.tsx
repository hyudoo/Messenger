"use client";

import dynamic from "next/dynamic";
import { Popover, PopoverButton, PopoverPanel } from "@headlessui/react";
import { HiOutlineFaceSmile } from "react-icons/hi2";
import { useLocale, useTranslations } from "next-intl";
import type { EmojiClickData, EmojiDataLoader } from "emoji-picker-react";

import { useTheme } from "./providers/ThemeProvider";

// The picker and its dataset are large: loaded only when first shown.
const Picker = dynamic(() => import("emoji-picker-react"), {
  ssr: false,
  loading: () => <div className="h-[380px] w-[320px]" />,
});

// Module scope: a new loader identity would load the dataset again.
// English is the picker's built-in default.
const DATASETS: Record<string, EmojiDataLoader | undefined> = {
  vi: () => import("emoji-picker-react/data/emojis-vi"),
};

interface EmojiPickerPanelProps {
  onSelect: (emoji: string) => void;
}

// The full emoji picker, in the app's language and theme. Also used by the
// message reaction picker ("more" emoji).
export const EmojiPickerPanel: React.FC<EmojiPickerPanelProps> = ({ onSelect }) => {
  const t = useTranslations("emoji");
  const locale = useLocale();
  const { resolvedTheme } = useTheme();

  return (
    <Picker
      onEmojiClick={(data: EmojiClickData) => onSelect(data.emoji)}
      theme={resolvedTheme}
      emojiData={DATASETS[locale]}
      lazyLoadEmojis
      width={320}
      height={380}
      previewConfig={{ showPreview: false }}
      labels={{
        searchPlaceholder: t("search"),
        searchLabel: t("search"),
        searchClear: t("clear"),
        searchResultsNone: t("no_results"),
        loading: t("loading"),
      }}
    />
  );
};

interface EmojiPickerProps {
  onSelect: (emoji: string) => void;
}

// A smiley button opening an emoji picker above it; stays open for several picks.
const EmojiPicker: React.FC<EmojiPickerProps> = ({ onSelect }) => {
  const t = useTranslations("emoji");

  return (
    <Popover className="relative flex">
      <PopoverButton
        aria-label={t("open")}
        title={t("open")}
        className="rounded-full text-sky-500 transition hover:text-sky-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-sky-500">
        <HiOutlineFaceSmile size={28} />
      </PopoverButton>
      <PopoverPanel
        anchor={{ to: "top start", gap: 12 }}
        className="z-50 rounded-lg shadow-xl">
        <EmojiPickerPanel onSelect={onSelect} />
      </PopoverPanel>
    </Popover>
  );
};

export default EmojiPicker;
