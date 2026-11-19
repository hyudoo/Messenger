// Public, indexable pages (without the locale prefix). Everything behind sign-in (proxy.ts
// PROTECTED_PATHS) and the one-off account links (reset / verify) stay out of search engines.
export const PUBLIC_PATHS = ["", "/privacy", "/terms"] as const;

export const PRIVATE_PATHS = [
  "/conversations",
  "/users",
  "/room",
  "/join",
  "/forgot-password",
  "/reset-password",
  "/verify-email",
] as const;

// The site's public origin: NEXTAUTH_URL (the same origin mails link to), read at request time.
export const siteOrigin = () =>
  (process.env.NEXTAUTH_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");

export const localizedUrl = (origin: string, locale: string, path: string) =>
  `${origin}/${locale}${path}`;

