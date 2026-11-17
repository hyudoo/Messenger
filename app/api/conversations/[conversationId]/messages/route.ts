import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import getMessages, { getMessagesAfter } from "@/app/actions/getMessages";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// GET ?before=<messageId>: the page of messages older than that message
// GET ?after=<messageId>: the messages newer than it (catching up after a reconnect)
// GET (no cursor): the latest page
export async function GET(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    const { conversationId } = await params;
    const conversation = await getConversationForUser(
      conversationId,
      currentUser.id
    );
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const before = searchParams.get("before");
    const after = searchParams.get("after");
    if ((before && after) || [before, after].some((id) => id !== null && !OBJECT_ID.test(id))) {
      return new NextResponse("Invalid cursor", { status: 400 });
    }

    if (after) {
      return NextResponse.json(await getMessagesAfter(conversation.id, after));
    }
    return NextResponse.json(await getMessages(conversation.id, before ?? undefined));
  } catch (error) {
    logError("messages_page", error);
    return new NextResponse("Error", { status: 500 });
  }
}
