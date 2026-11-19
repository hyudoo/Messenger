import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { emitGroupUpdate } from "@/app/libs/conversation-members";
import { parseNickname, withNickname } from "@/app/libs/nicknames";
import prisma from "@/app/libs/prismadb";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { postSystemMessage } from "@/app/libs/system-message";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// PATCH { userId, nickname }: sets (or with "" / null removes) what a member is called in this
// conversation, 1:1 or group. Any member may set anyone's, their own too. The members get the new
// list (conversation:update, the open chat refreshes) and a `nickname` event names who did it.
// Setting the same nickname again changes nothing.
export async function PATCH(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const conversation = await getConversationForUser((await params).conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    const body = await request.json().catch(() => ({}));
    const nickname = parseNickname(body?.nickname);
    const member = conversation.users.find((user) => user.id === body?.userId);
    if (nickname === undefined || !member) {
      return new NextResponse("Invalid data", { status: 400 });
    }

    const current = conversation.nicknames ?? [];
    const before = current.find((item) => item.userId === member.id)?.nickname ?? null;
    if (before === nickname) {
      return NextResponse.json({ nicknames: current });
    }
    const updated = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { nicknames: { set: withNickname(current, member.id, nickname) } },
      include: { users: true },
    });

    await emitGroupUpdate(updated, updated.users);
    await postSystemMessage({
      conversation: updated,
      actorId: currentUser.id,
      type: "nickname",
      name: nickname,
      users: [member],
    });
    return NextResponse.json({ nicknames: updated.nicknames });
  } catch (error) {
    logError("conversation_nickname", error);
    return new NextResponse("Error", { status: 500 });
  }
}
