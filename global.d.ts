import type { routing } from "./i18n/routing";
import type messages from "./i18n/messages/vi.json";

// Typed next-intl: t("...") only accepts keys that exist in vi.json, so tsc
// catches a typo or a removed key (en.json is checked against vi.json in tests).
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof routing.locales)[number];
    Messages: typeof messages;
  }
}
