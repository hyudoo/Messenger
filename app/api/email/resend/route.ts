import { NextResponse } from "next/server";

import { accountMailAvailable, isEmail, localeOf } from "@/app/libs/account-mail";
import { needsEmailVerification } from "@/app/libs/email-verification";
import prisma from "@/app/libs/prismadb";
import { clientIp, rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { sendVerificationMail } from "@/app/libs/verification-mail";

// POST { email, locale }: mails a new "verify your email" link when an account with that address
// still waits for one (earlier links stop working). The answer is the same either way, so it
// can't be used to find out who has an account. Rate limited per IP and per address; 503 when mail
// can't go out (production without SMTP).
export async function POST(request: Request) {
  try {
    const limited = await rateLimit("verifyMail", clientIp(request.headers));
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const body = await request.json().catch(() => ({}));
    const email = typeof body?.email === "string" ? body.email.trim() : "";
    if (!isEmail(email)) {
      return new NextResponse("Invalid email", { status: 400 });
    }
    if (!accountMailAvailable(request)) {
      return new NextResponse("Email verification is not set up", { status: 503 });
    }
    const perAddress = await rateLimit("verifyMailAddress", email.toLowerCase());
    if (!perAddress.ok) {
      return tooManyRequests(perAddress.retryAfter);
    }

    const user = await prisma.user.findFirst({
      where: { email: { equals: email, mode: "insensitive" } },
      select: { id: true, email: true, name: true, emailVerified: true, mustVerifyEmail: true },
    });
    if (user?.email && needsEmailVerification(user)) {
      await sendVerificationMail(
        request,
        { id: user.id, email: user.email, name: user.name },
        localeOf(body?.locale)
      );
    }
    // the same answer whether the account exists (or is verified) or not
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("email_resend", error);
    return new NextResponse("Error", { status: 500 });
  }
}
