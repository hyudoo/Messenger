import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { friendIdsOf, unfriend } from "@/app/libs/friends";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { notifyContactsChanged } from "@/app/libs/socket-server";
import { logError } from "@/app/libs/log";

interface IParams {
  userId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// DELETE: no longer friends (both sides). Their chat stays; presence goes on while they still
// share a conversation.
export async function DELETE(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("friend", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }
    const { userId } = await params;
    if (!userId || !OBJECT_ID.test(userId) || !(await friendIdsOf(currentUser.id)).includes(userId)) {
      return new NextResponse("Not found", { status: 404 });
    }
    await unfriend(currentUser.id, userId);
    const other = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    notifyContactsChanged([currentUser.email, other?.email], true);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logError("unfriend", error);
    return new NextResponse("Error", { status: 500 });
  }
}
