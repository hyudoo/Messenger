import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { privacyOf } from "@/app/libs/privacy";
import { notifyActivityPrivacyChanged } from "@/app/libs/socket-server";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import prisma from "@/app/libs/prismadb";
import { logError } from "@/app/libs/log";

// GET: the user's privacy settings and the people they blocked (the settings modal's list, with
// Unblock through POST /api/users/[userId]/block).
export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const [privacy, own] = await Promise.all([
      privacyOf(currentUser.id),
      prisma.user.findUnique({ where: { id: currentUser.id }, select: { blockedUserIds: true } }),
    ]);
    const blocked = own?.blockedUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: own.blockedUserIds } },
          select: { id: true, name: true, email: true, image: true },
          orderBy: { name: "asc" },
        })
      : [];
    return NextResponse.json({ ...privacy, blocked });
  } catch (error) {
    logError("privacy_get", error);
    return new NextResponse("Error", { status: 500 });
  }
}

// PATCH { hideActivity?, hideReadReceipts? }: applies at once. Hiding activity takes the user out
// of everyone's presence (and theirs out of the user's) right away (notifyActivityPrivacyChanged);
// read receipts apply to the next reads.
export async function PATCH(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const limited = await rateLimit("settings", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const body = await request.json().catch(() => ({}));
    const data: { hideActivity?: boolean; hideReadReceipts?: boolean } = {};
    if (typeof body?.hideActivity === "boolean") {
      data.hideActivity = body.hideActivity;
    }
    if (typeof body?.hideReadReceipts === "boolean") {
      data.hideReadReceipts = body.hideReadReceipts;
    }
    if (Object.keys(data).length === 0) {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const before = await privacyOf(currentUser.id);
    const updated = await prisma.user.update({
      where: { id: currentUser.id },
      data,
      select: { hideActivity: true, hideReadReceipts: true },
    });
    const hideActivity = !!updated.hideActivity;
    if (hideActivity !== before.hideActivity) {
      notifyActivityPrivacyChanged(currentUser.email, hideActivity);
    }
    return NextResponse.json({ hideActivity, hideReadReceipts: !!updated.hideReadReceipts });
  } catch (error) {
    logError("privacy_update", error);
    return new NextResponse("Error", { status: 500 });
  }
}
