import { defineRouting } from "next-intl/routing";

// URLs are always prefixed (/vi/conversations); the chosen locale is remembered
// in the NEXT_LOCALE cookie by the next-intl middleware (run from proxy.ts).
export const routing = defineRouting({
  locales: ["vi", "en"],
  defaultLocale: "vi",
});

export type Locale = (typeof routing.locales)[number];
