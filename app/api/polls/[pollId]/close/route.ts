import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { canClosePoll } from "@/app/libs/poll-rules";
import { emitPollUpdate, loadPollForMember } from "@/app/libs/polls";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  pollId?: string;
}

// POST: closes a poll (no more votes; the results stay). Whoever asked it or a group admin
// (canClosePoll). Closing it again changes nothing.
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const found = await loadPollForMember((await params).pollId, currentUser.id);
    if (!found) {
      return new NextResponse("Not found", { status: 404 });
    }
    const { poll, conversation } = found;
    if (!canClosePoll(conversation, poll.message, currentUser.id)) {
      return new NextResponse("Only who asked or an admin can close it", { status: 403 });
    }
    if (!poll.closedAt) {
      await prisma.poll.update({
        where: { id: poll.id },
        data: { closedAt: new Date() },
        select: { id: true },
      });
    }

    const message = await emitPollUpdate(poll.message.id, poll.message.conversationId);
    return NextResponse.json(message);
  } catch (error) {
    logError("poll_close", error);
    return new NextResponse("Error", { status: 500 });
  }
}
