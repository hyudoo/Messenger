import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import { validatePassword } from "@/app/libs/password";
import { clearResetTokens, userOfResetToken } from "@/app/libs/password-reset";
import { clientIp, rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { revokeSessions } from "@/app/libs/sessions";

// POST { token, password }: sets a new password from a "forgot password" link (same rules as
// registering). The link stops working, and so do the user's other ones. 400 with the broken
// rule's code, or "invalid_token" for an unknown / used / expired link. Rate limited per IP.
// Every session of the user ends (whoever had the old password is signed out everywhere).
export async function POST(request: Request) {
  try {
    const limited = await rateLimit("passwordReset", clientIp(request.headers));
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const { token, password } = await request.json().catch(() => ({}));
    const passwordError = validatePassword(password);
    if (passwordError) {
      return new NextResponse(passwordError, { status: 400 });
    }
    const userId = await userOfResetToken(token);
    if (!userId) {
      return new NextResponse("invalid_token", { status: 400 });
    }

    // the link came by mail, so it also proves the address (an unverified account can sign in now)
    await revokeSessions(userId, {
      hashedPassword: await bcrypt.hash(password, 12),
      emailVerified: new Date(),
    });
    await clearResetTokens(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("password_reset", error);
    return new NextResponse("Error", { status: 500 });
  }
}
