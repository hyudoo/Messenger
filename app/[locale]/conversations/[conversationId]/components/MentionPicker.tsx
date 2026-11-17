"use client";

import clsx from "clsx";
import Image from "next/image";
import { useTranslations } from "next-intl";

import { matchesSearch } from "@/app/libs/search";
import { mentionQueryAt } from "@/app/libs/mentions";
import { SafeUser } from "@/app/types";

// suggestions shown at once
const MAX_SUGGESTIONS = 6;

// The members matching the "@word" typed before the caret (none outside a mention).
export const mentionSuggestions = (
  text: string,
  caret: number,
  members: SafeUser[],
  myEmail?: string | null
) => {
  const at = mentionQueryAt(text, caret);
  if (!at) {
    return null;
  }
  const people = members
    .filter((member) => member.email !== myEmail && member.name)
    .filter((member) => matchesSearch(at.query, member.name))
    .slice(0, MAX_SUGGESTIONS);
  return people.length > 0 ? { ...at, people } : null;
};

interface MentionPickerProps {
  people: SafeUser[];
  active: number;
  onPick: (person: SafeUser) => void;
}

// The list above the composer while typing "@…" in a group: arrows move, Enter / Tab pick, Esc
// closes (handled by Form through MessageInput's onKeyDownFirst).
const MentionPicker: React.FC<MentionPickerProps> = ({ people, active, onPick }) => {
  const t = useTranslations("chat");
  return (
    <ul
      role="listbox"
      aria-label={t("mention_suggestions")}
      className="absolute bottom-full left-0 z-20 mb-2 w-64 max-w-full overflow-hidden rounded-xl border bg-background py-1 shadow-lg">
      {people.map((person, index) => (
        <li key={person.id} role="option" aria-selected={index === active}>
          <button
            type="button"
            // keeps the focus (and the caret) in the textarea
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => onPick(person)}
            className={clsx(
              "flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm text-foreground",
              index === active ? "bg-muted" : "hover:bg-muted"
            )}>
            <Image
              src={person.image || "/images/placeholder.jpg"}
              alt=""
              width={24}
              height={24}
              className="h-6 w-6 rounded-full object-cover"
            />
            <span className="truncate">{person.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
};

export default MentionPicker;
