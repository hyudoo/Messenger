import { NextResponse } from "next/server";
import { createTranslator, hasLocale } from "next-intl";

import vi from "@/i18n/messages/vi.json";
import en from "@/i18n/messages/en.json";
import { routing } from "@/i18n/routing";
import { mailConfigured, sendMail } from "@/app/libs/mailer";
import { RESET_TTL_MS, createResetToken } from "@/app/libs/password-reset";
import prisma from "@/app/libs/prismadb";
import { clientIp, rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

const MESSAGES = { vi, en } as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);

// Where the link points: always NEXTAUTH_URL, never the request's Host header (which a client sets,
// so a forged one would send the link to another site). Outside production the request's own
// origin is a fallback for local testing.
const appOrigin = (request: Request) => {
  const configured = process.env.NEXTAUTH_URL?.trim();
  if (configured) {
    return configured.replace(/\/+$/, "");
  }
  return process.env.NODE_ENV === "production" ? null : new URL(request.url).origin;
};

// POST { email, locale }: mails a "reset your password" link (app/libs/password-reset.ts) when an
// account has that address. The answer is the same either way, so the form can't be used to find
// out who has an account. Rate limited per IP and per address. Without SMTP (app/libs/mailer.ts):
// 503 in production; in development the link is printed in the server's console instead.
export async function POST(request: Request) {
  try {
    const limited = await rateLimit("passwordReset", clientIp(request.headers));
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    const requested: unknown = body?.locale;
    const locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;
    if (!EMAIL.test(email) || email.length > 254) {
      return new NextResponse("Invalid email", { status: 400 });
    }

    const origin = appOrigin(request);
    const production = process.env.NODE_ENV === "production";
    if (!origin || (production && !mailConfigured())) {
      return new NextResponse("Password reset by email is not set up", { status: 503 });
    }

    const perAddress = await rateLimit("passwordResetEmail", email.toLowerCase());
    if (!perAddress.ok) {
      return tooManyRequests(perAddress.retryAfter);
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, name: true },
    });
    if (user?.email) {
      const token = await createResetToken(user.id);
      const link = `${origin}/${locale}/reset-password?token=${token}`;
      if (!mailConfigured()) {
        // development without SMTP: the link goes to the server's console
        console.info(`[password reset] ${link}`);
      } else {
        const t = createTranslator({ locale, messages: MESSAGES[locale], namespace: "reset_mail" });
        const minutes = Math.round(RESET_TTL_MS / 60_000);
        const greeting = t("greeting", { name: user.name ?? "" });
        const text = [greeting, "", t("body", { minutes }), link, "", t("ignore")].join("\n");
        const html = `<p>${escapeHtml(greeting)}</p><p>${escapeHtml(t("body", { minutes }))}</p><p><a href="${escapeHtml(link)}">${escapeHtml(t("button"))}</a></p><p style="color:#666">${escapeHtml(t("ignore"))}</p>`;
        await sendMail({ to: user.email, subject: t("subject"), text, html });
      }
    }
    // the same answer whether the account exists or not
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("password_forgot", error);
    return new NextResponse("Error", { status: 500 });
  }
}
