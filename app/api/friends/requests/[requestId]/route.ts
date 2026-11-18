import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { makeFriends } from "@/app/libs/friends";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { notifyContactsChanged } from "@/app/libs/socket-server";
import { logError } from "@/app/libs/log";

interface IParams {
  requestId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// The request with both people's emails, for the caller in `role`; null for "missing" and
// "not theirs" alike.
const loadRequest = async (requestId: string | undefined, userId: string, role: "from" | "to") => {
  if (!requestId || !OBJECT_ID.test(requestId)) {
    return null;
  }
  const request = await prisma.friendRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      fromId: true,
      toId: true,
      from: { select: { email: true } },
      to: { select: { email: true } },
    },
  });
  const mine = role === "from" ? request?.fromId === userId : request?.toId === userId;
  return request && mine ? request : null;
};

const guard = async () => {
  const currentUser = await getCurrentUser();
  if (!currentUser?.id) {
    return { error: new NextResponse("Unauthorized", { status: 401 }) };
  }
  const limited = await rateLimit("friend", currentUser.id);
  if (!limited.ok) {
    return { error: tooManyRequests(limited.retryAfter) };
  }
  return { userId: currentUser.id };
};

// POST { accept }: the recipient answers: accepted, both are friends; declined, the request just
// goes (the sender isn't told, their request disappears from their list on the next reload).
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const { error, userId } = await guard();
    if (error) {
      return error;
    }
    const { accept } = await request.json().catch(() => ({}));
    if (typeof accept !== "boolean") {
      return new NextResponse("Invalid data", { status: 400 });
    }
    const friendRequest = await loadRequest((await params).requestId, userId, "to");
    if (!friendRequest) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (accept) {
      await makeFriends(friendRequest.fromId, friendRequest.toId);
    } else {
      await prisma.friendRequest.delete({ where: { id: friendRequest.id } });
    }
    notifyContactsChanged([friendRequest.from.email, friendRequest.to.email], true);
    return NextResponse.json({ accepted: accept });
  } catch (error) {
    logError("friend_request_answer", error);
    return new NextResponse("Error", { status: 500 });
  }
}

// DELETE: the sender takes their request back.
export async function DELETE(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const { error, userId } = await guard();
    if (error) {
      return error;
    }
    const friendRequest = await loadRequest((await params).requestId, userId, "from");
    if (!friendRequest) {
      return new NextResponse("Not found", { status: 404 });
    }
    await prisma.friendRequest.delete({ where: { id: friendRequest.id } });
    notifyContactsChanged([friendRequest.from.email, friendRequest.to.email], true);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    logError("friend_request_cancel", error);
    return new NextResponse("Error", { status: 500 });
  }
}
