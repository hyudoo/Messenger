"use client";

import { useTranslations } from "next-intl";
import { HiMoon, HiSun } from "react-icons/hi2";

import { useTheme } from "../providers/ThemeProvider";

// Flips between light and dark (the settings modal also offers "system").
// The icons swap with the dark: variant, so the first render matches the server.
const ThemeToggle = () => {
  const t = useTranslations("theme");
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={() => setTheme(resolvedTheme === "dark" ? "light" : "dark")}
      className="relative flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition"
      aria-label={t("toggle")}
      title={t("toggle")}>
      <HiSun className="h-5 w-5 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
      <HiMoon className="absolute h-5 w-5 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
    </button>
  );
};

export default ThemeToggle;
