import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { parseVote } from "@/app/libs/poll-rules";
import { emitPollUpdate, loadPollForMember } from "@/app/libs/polls";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  pollId?: string;
}

// POST { optionIds }: the caller's votes on a poll, replacing their earlier ones (an empty list
// takes the vote back). One option unless the poll takes several; members only; closed polls
// answer 409. The chat gets the message with the new votes (messages:update).
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("reaction", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const found = await loadPollForMember((await params).pollId, currentUser.id);
    if (!found) {
      return new NextResponse("Not found", { status: 404 });
    }
    const { poll } = found;
    if (poll.closedAt) {
      return new NextResponse("Poll closed", { status: 409 });
    }
    const { optionIds } = await request.json().catch(() => ({}));
    const picked = parseVote(poll, optionIds);
    if (!picked) {
      return new NextResponse("Invalid vote", { status: 400 });
    }

    await prisma.$transaction([
      prisma.pollVote.deleteMany({ where: { pollId: poll.id, userId: currentUser.id } }),
      ...picked.map((optionId) =>
        prisma.pollVote.create({
          data: { pollId: poll.id, userId: currentUser.id, optionId },
          select: { id: true },
        })
      ),
    ]);

    const message = await emitPollUpdate(poll.message.id, poll.message.conversationId);
    return NextResponse.json(message);
  } catch (error) {
    logError("poll_vote", error);
    return new NextResponse("Error", { status: 500 });
  }
}
