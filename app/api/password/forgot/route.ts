import { NextResponse } from "next/server";

import { accountMailAvailable, appOrigin, isEmail, localeOf, mailLink } from "@/app/libs/account-mail";
import { RESET_TTL_MS, createResetToken } from "@/app/libs/password-reset";
import prisma from "@/app/libs/prismadb";
import { clientIp, rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

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
    const locale = localeOf(body?.locale);
    if (!isEmail(email)) {
      return new NextResponse("Invalid email", { status: 400 });
    }

    if (!accountMailAvailable(request)) {
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
      await mailLink({
        to: user.email,
        name: user.name,
        locale,
        namespace: "reset_mail",
        link: `${appOrigin(request)}/${locale}/reset-password?token=${token}`,
        values: { minutes: Math.round(RESET_TTL_MS / 60_000) },
      });
    }
    // the same answer whether the account exists or not
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("password_forgot", error);
    return new NextResponse("Error", { status: 500 });
  }
}
