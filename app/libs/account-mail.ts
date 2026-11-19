import { appendFileSync } from "fs";
import { createTranslator, hasLocale } from "next-intl";

import vi from "@/i18n/messages/vi.json";
import en from "@/i18n/messages/en.json";
import { routing } from "@/i18n/routing";
import { mailConfigured, sendMail } from "./mailer";

// The account mails that carry a one-time link ("forgot password", "verify your email"), shared
// by their routes: where links point, the locale, and writing / sending the mail.

const MESSAGES = { vi, en } as const;
export type Locale = keyof typeof MESSAGES;

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isEmail = (value: string) => EMAIL.test(value) && value.length <= 254;

export const localeOf = (requested: unknown): Locale =>
  hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Where links point: always NEXTAUTH_URL, never the request's Host header (which a client sets,
// so a forged one would send the link to another site). Outside production the request's own
// origin is a fallback for local testing. null: production without NEXTAUTH_URL.
export const appOrigin = (request: Request) => {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
};

// Whether these mails can go out at all: production needs SMTP (and NEXTAUTH_URL); development
// without SMTP prints them instead (mailLink).
export const accountMailAvailable = (request: Request) =>
  !!appOrigin(request) && (process.env.NODE_ENV !== "production" || mailConfigured());

// Mails `link` with the texts of a mail namespace (subject / greeting / body / button / ignore;
// `values` fill the body). Without SMTP (development only, see accountMailAvailable) the link goes
// to the server's console, and to MAIL_OUTBOX_FILE when set (the E2E server reads links there).
export const mailLink = async ({
  to,
  name,
  locale,
  namespace,
  link,
  values,
}: {
  to: string;
  name: string | null;
  locale: Locale;
  namespace: "reset_mail" | "verify_mail";
  link: string;
  values: Record<string, number>;
}) => {
  const t = createTranslator({ locale, messages: MESSAGES[locale], namespace });
  const greeting = t("greeting", { name: name ?? "" });
  const body = t("body", values);
  const subject = t("subject");

  if (!mailConfigured()) {
    console.info(`[${namespace}] ${link}`);
    const outbox = process.env.MAIL_OUTBOX_FILE;
    if (outbox && process.env.NODE_ENV !== "production") {
      appendFileSync(outbox, `${JSON.stringify({ to, subject, link })}\n`);
    }
    return true;
  }
  const text = [greeting, "", body, link, "", t("ignore")].join("\n");
  const html = `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(body)}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("button"))}</a></p><p style="color:#666">${escapeHtml(t("ignore"))}</p>`;
  return sendMail({ to, subject, text, html });
};
