import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { sendFriendRequest } from "@/app/libs/friends";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { notifyContactsChanged } from "@/app/libs/socket-server";
import { logError } from "@/app/libs/log";

const OBJECT_ID = /^[a-f\d]{24}$/i;

// GET: how many friend requests wait for the caller (the badge on "Contacts").
export async function GET() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const incoming = await prisma.friendRequest.count({ where: { toId: currentUser.id } });
    return NextResponse.json({ incoming });
  } catch (error) {
    logError("friend_request_count", error);
    return new NextResponse("Error", { status: 500 });
  }
}

// POST { userId }: asks someone to be friends (sendFriendRequest). Someone who already asked the
// caller: both are friends at once. Answers { status }: requested / pending (already asked) /
// accepted / friends (already); 403 between block partners, 409 with too many waiting. Both
// sides' tabs reload their contacts (contacts:update).
export async function POST(request: Request) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("friend", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { userId } = await request.json().catch(() => ({}));
    if (typeof userId !== "string" || !OBJECT_ID.test(userId) || userId === currentUser.id) {
      return new NextResponse("Invalid data", { status: 400 });
    }
    const target = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!target) {
      return new NextResponse("Not found", { status: 404 });
    }

    const status = await sendFriendRequest(currentUser.id, userId);
    if (status === "blocked") {
      return new NextResponse("Blocked", { status: 403 });
    }
    if (status === "too_many") {
      return new NextResponse("Too many requests waiting", { status: 409 });
    }
    if (status === "requested" || status === "accepted") {
      notifyContactsChanged([currentUser.email, target.email], true);
    }
    return NextResponse.json({ status });
  } catch (error) {
    logError("friend_request", error);
    return new NextResponse("Error", { status: 500 });
  }
}
