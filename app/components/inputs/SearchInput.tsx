"use client";

import { HiMagnifyingGlass, HiXMark } from "react-icons/hi2";
import { useTranslations } from "next-intl";

interface SearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

// The filter box above the inbox and the contacts list (app/libs/search.ts does the matching).
const SearchInput: React.FC<SearchInputProps> = ({ value, onChange, placeholder }) => {
  const t = useTranslations("common");

  return (
    <div className="relative mb-3">
      <HiMagnifyingGlass
        size={16}
        aria-hidden
        className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
      />
      <input
        type="search"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => event.key === "Escape" && onChange("")}
        placeholder={placeholder}
        aria-label={placeholder}
        className="
          w-full
          rounded-full
          border-0
          bg-muted
          py-2
          pl-9
          pr-9
          text-sm
          text-foreground
          placeholder:text-muted-foreground
          focus:ring-2
          focus:ring-sky-500
          [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label={t("clear")}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
          <HiXMark size={16} aria-hidden />
        </button>
      )}
    </div>
  );
};

export default SearchInput;
