import bcrypt from "bcrypt";
import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { deleteAccount } from "@/app/libs/account-delete";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { secureCookie, sessionCookieName } from "@/app/libs/session-version";
import { logError } from "@/app/libs/log";

// GET: how deleting is confirmed: { hasPassword } (else by typing the email address).
export async function GET() {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return new NextResponse("Unauthorized", { status: 401 });
  }
  const stored = await prisma.user
    .findUnique({ where: { id: currentUser.id }, select: { hashedPassword: true } })
    .catch(() => null);
  return NextResponse.json({ hasPassword: !!stored?.hashedPassword });
}

// DELETE { password?, email? }: deletes the signed-in user's account and what is only theirs
// (app/libs/account-delete.ts). An account with a password confirms with it ("wrong_password");
// one signed in only through GitHub / Google types its email address ("wrong_email"). Rate limited
// with password changes. The answer clears this device's session cookie; the others' sessions
// fail at once (the user no longer exists).
export async function DELETE(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("passwordChange", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { password, email } = await request.json().catch(() => ({}));
    const stored = await prisma.user.findUnique({
      where: { id: currentUser.id },
      select: { hashedPassword: true, email: true },
    });
    if (!stored) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (stored.hashedPassword) {
      if (typeof password !== "string" || !(await bcrypt.compare(password, stored.hashedPassword))) {
        return new NextResponse("wrong_password", { status: 400 });
      }
    } else if (
      typeof email !== "string" ||
      !stored.email ||
      email.trim().toLowerCase() !== stored.email.toLowerCase()
    ) {
      return new NextResponse("wrong_email", { status: 400 });
    }

    await deleteAccount(currentUser.id);

    const response = NextResponse.json({ ok: true });
    response.cookies.set(sessionCookieName(), "", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      secure: secureCookie(),
      maxAge: 0,
    });
    return response;
  } catch (error) {
    logError("account_delete", error);
    return new NextResponse("Error", { status: 500 });
  }
}
