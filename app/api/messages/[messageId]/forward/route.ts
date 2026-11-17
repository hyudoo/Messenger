import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import prisma from "@/app/libs/prismadb";
import { canForwardMessage } from "@/app/libs/message-actions";
import { deliverMessage } from "@/app/libs/message-delivery";
import { MESSAGE_INCLUDE } from "@/app/libs/message-include";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  messageId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// POST { conversationId }: sends a copy of a message (text, image, file or voice) to another
// conversation of the caller, marked forwarded. The caller must be in both. The copy shares the
// original's file (cleanUpUploads keeps a file while any message uses it).
export async function POST(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id || !currentUser.email) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("message", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { messageId } = await params;
    const { conversationId } = await request.json().catch(() => ({}));
    const original =
      messageId && OBJECT_ID.test(messageId)
        ? await prisma.message.findUnique({ where: { id: messageId } })
        : null;
    // "missing" and "not a member" look the same, for the source and the target
    const [source, target] = await Promise.all([
      original && getConversationForUser(original.conversationId, currentUser.id),
      getConversationForUser(conversationId, currentUser.id),
    ]);
    if (!original || !source || !target) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canForwardMessage(original)) {
      return new NextResponse("This message can't be forwarded", { status: 400 });
    }

    const copy = await prisma.message.create({
      include: MESSAGE_INCLUDE,
      data: {
        body: original.body ?? undefined,
        image: original.image ?? undefined,
        attachment: original.attachment ?? undefined,
        forwarded: true,
        conversationId: target.id,
        senderId: currentUser.id,
        seenIds: [currentUser.id],
      },
    });
    await deliverMessage({ conversation: target, sender: currentUser, message: copy });
    return NextResponse.json(copy);
  } catch (error) {
    logError("message_forward", error);
    return new NextResponse("Error", { status: 500 });
  }
}
