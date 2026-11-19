import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { validatePassword } from "@/app/libs/password";
import { clearResetTokens } from "@/app/libs/password-reset";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { reissueSession, revokeSessions } from "@/app/libs/sessions";
import { logError } from "@/app/libs/log";

// POST { currentPassword, newPassword }: changes the signed-in user's password (same rules as
// registering). Every other session of the user ends; this device gets a new session cookie.
// 400 with the broken rule's code, "wrong_password", or "no_password" (an OAuth-only account: it
// sets one through "forgot password"). Rate limited per user.
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("passwordChange", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { currentPassword, newPassword } = await request.json().catch(() => ({}));
    const passwordError = validatePassword(newPassword);
    if (passwordError) {
      return new NextResponse(passwordError, { status: 400 });
    }

    const stored = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { hashedPassword: true },
    });
    if (!stored?.hashedPassword) {
      return new NextResponse("no_password", { status: 400 });
    }
    if (
      typeof currentPassword !== "string" ||
      !(await bcrypt.compare(currentPassword, stored.hashedPassword))
    ) {
      return new NextResponse("wrong_password", { status: 400 });
    }

    const { user, version } = await revokeSessions(currentUser.id, {
      hashedPassword: await bcrypt.hash(newPassword, 12),
    });
    // a "forgot password" link sent earlier would set it back
    await clearResetTokens(currentUser.id);
    return reissueSession(NextResponse.json({ ok: true }), user, version);
  } catch (error) {
    logError("password_change", error);
    return new NextResponse("Error", { status: 500 });
  }
}
