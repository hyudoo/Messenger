import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { notifyBlocksChanged } from "@/app/libs/socket-server";
import { logError } from "@/app/libs/log";

interface IParams {
  userId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// POST { blocked }: blocks or unblocks a user (app/libs/blocks.ts has what that means). Both
// sides' tabs are told (block:update) and the presence they see is recomputed.
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("settings", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { userId } = await params;
    const { blocked } = await request.json().catch(() => ({}));
    if (!userId || !OBJECT_ID.test(userId) || userId === currentUser.id || typeof blocked !== "boolean") {
      return new NextResponse("Invalid data", { status: 400 });
    }
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!target) {
      return new NextResponse("Not found", { status: 404 });
    }

    const own = await prisma.user.findUniqueOrThrow({
      where: { id: currentUser.id },
      select: { blockedUserIds: true },
    });
    const blockedUserIds = blocked
      ? Array.from(new Set([...own.blockedUserIds, userId]))
      : own.blockedUserIds.filter((id) => id !== userId);
    await prisma.user.update({
      where: { id: currentUser.id },
      data: { blockedUserIds },
      select: { id: true },
    });

    notifyBlocksChanged([currentUser.email, target.email].filter((email): email is string => !!email));
    return NextResponse.json({ userId, blocked });
  } catch (error) {
    logError("user_block", error);
    return new NextResponse("Error", { status: 500 });
  }
}
