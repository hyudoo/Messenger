"use client";

import { useLocale, useTranslations } from "next-intl";
import { HiLanguage } from "react-icons/hi2";

import { usePathname, useRouter } from "@/i18n/navigation";

// Switches vi <-> en on the current page (same as the portfolio CMS); the badge
// shows the language you would switch to. usePathname() is the real path without
// the locale (no `pathnames` config), so it can be replayed as-is.
const LanguageToggle = () => {
  const t = useTranslations("language");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const next = locale === "en" ? "vi" : "en";

  return (
    <button
      type="button"
      onClick={() => router.replace(pathname, { locale: next })}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition"
      aria-label={t("toggle")}
      title={t("toggle")}>
      <HiLanguage className="h-5 w-5" />
      <span className="absolute -bottom-0.5 -right-0.5 rounded bg-sky-500 px-1 text-[10px] font-bold uppercase leading-4 text-white">
        {next}
      </span>
    </button>
  );
};

export default LanguageToggle;
