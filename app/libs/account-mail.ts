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
  const tMail = createTranslator({ locale, messages: MESSAGES[locale], namespace: "mail" });
  const text = [greeting, "", body, link, "", t("ignore"), "", "—", tMail("footer")].join("\n");
  const html = mailHtml({
    locale,
    origin: new URL(link).origin,
    subject,
    preheader: body,
    greeting,
    body,
    button: t("button"),
    link,
    fallback: tMail("fallback"),
    ignore: t("ignore"),
    footer: tMail("footer"),
  });
  return sendMail({ to, subject, text, html });
};

// The HTML of an account mail: a table layout with inline styles (what mail clients reliably
// render: no <style> classes, flexbox or web fonts), a bulletproof button, the link spelled out
// for clients that strip buttons, and a hidden preheader (the preview line in the inbox).
const BRAND = "#0ea5e9";
const mailHtml = (m: {
  locale: Locale;
  origin: string;
  subject: string;
  preheader: string;
  greeting: string;
  body: string;
  button: string;
  link: string;
  fallback: string;
  ignore: string;
  footer: string;
}) => {
  const e = escapeHtml;
  const font = "font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;";
  return `<!doctype html>
<html lang="${m.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>${e(m.subject)}</title>
</head>
<body style="margin:0;padding:0;background:#f4f4f5;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${e(m.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:480px;">
<tr><td align="center" style="padding:0 0 20px;${font}">
<a href="${e(m.origin)}" style="text-decoration:none;color:#18181b;font-size:18px;font-weight:600;">
<img src="${e(m.origin)}/images/logo.png" width="32" height="32" alt="" style="vertical-align:middle;border:0;margin-right:8px;">Messenger</a>
</td></tr>
<tr><td style="background:#ffffff;border:1px solid #e4e4e7;border-radius:16px;padding:32px;${font}color:#18181b;">
<p style="margin:0 0 16px;font-size:16px;font-weight:600;">${e(m.greeting)}</p>
<p style="margin:0 0 24px;font-size:15px;line-height:24px;color:#3f3f46;">${e(m.body)}</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tr>
<td align="center" bgcolor="${BRAND}" style="border-radius:8px;">
<a href="${e(m.link)}" target="_blank" style="display:block;padding:12px 24px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:8px;${font}">${e(m.button)}</a>
</td></tr></table>
<p style="margin:24px 0 6px;font-size:13px;line-height:20px;color:#71717a;">${e(m.fallback)}</p>
<p style="margin:0 0 24px;font-size:13px;line-height:20px;word-break:break-all;"><a href="${e(m.link)}" style="color:${BRAND};">${e(m.link)}</a></p>
<hr style="border:0;border-top:1px solid #e4e4e7;margin:0 0 16px;">
<p style="margin:0;font-size:13px;line-height:20px;color:#71717a;">${e(m.ignore)}</p>
</td></tr>
<tr><td align="center" style="padding:20px 8px 0;${font}font-size:12px;line-height:18px;color:#a1a1aa;">${e(m.footer)}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
};
