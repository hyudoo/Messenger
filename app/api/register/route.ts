import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { accountMailAvailable, isEmail, localeOf } from "@/app/libs/account-mail";
import { validatePassword } from "@/app/libs/password";
import prisma from "@/app/libs/prismadb";
import { clientIp, rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { sendVerificationMail } from "@/app/libs/verification-mail";

const MAX_NAME_LENGTH = 100;

// POST { email, name, password, locale }: a new account with a password. It can't sign in until
// its email is verified: a "verify your email" link is mailed now (app/libs/verification-mail.ts)
// and can be asked for again (POST /api/email/resend). 503 when mail can't go out (production
// without SMTP), since nobody could verify the account.
export async function POST(request: Request) {
  try {
    const limited = await rateLimit("register", clientIp(request.headers));
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { email, name, password, locale } = await request.json();
    const trimmedName = typeof name === "string" ? name.trim() : "";

    if (typeof email !== "string" || !isEmail(email) || !trimmedName) {
      return new NextResponse("Missing info", { status: 400 });
    }
    if (trimmedName.length > MAX_NAME_LENGTH) {
      return new NextResponse("Name too long", { status: 400 });
    }
    // same rules as the register form; the client check alone can be skipped
    const passwordError = validatePassword(password);
    if (passwordError) {
      return new NextResponse(passwordError, { status: 400 });
    }

    if (!accountMailAvailable(request)) {
      return new NextResponse("Registering by email is not set up", { status: 503 });
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true },
    });
    if (existingUser) {
      return new NextResponse("Email already in use", { status: 409 });
    }

    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await prisma.user.create({
      data: {
        email,
        name: trimmedName,
        hashedPassword,
        mustVerifyEmail: true,
      },
      select: { id: true, email: true, name: true },
    });
    // a failed mail is logged; the login form offers to send it again
    await sendVerificationMail(request, { ...user, email }, localeOf(locale));
    return NextResponse.json({ email: user.email, verify: true });
  } catch (error: any) {
    logError("registration", error);
    return new NextResponse("Internal Error", { status: 500 });
  }
}
