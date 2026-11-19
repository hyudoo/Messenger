import { NextResponse } from "next/server";

import { verifyEmailToken } from "@/app/libs/email-verification";
import { clientIp, rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

// POST { token }: a "verify your email" link (/verify-email?token=) was opened. Marks the
// account's email verified, so it can sign in, and ends the user's other links. 400
// "invalid_token" for an unknown / used / expired one. Rate limited per IP.
export async function POST(request: Request) {
  try {
    const limited = await rateLimit("emailVerify", clientIp(request.headers));
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const { token } = await request.json().catch(() => ({}));
    if (!(await verifyEmailToken(token))) {
      return new NextResponse("invalid_token", { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (error) {
    logError("email_verify", error);
    return new NextResponse("Error", { status: 500 });
  }
}
