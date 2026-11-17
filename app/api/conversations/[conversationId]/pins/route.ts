import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { findPinnedMessages } from "@/app/actions/getPinnedMessages";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// GET: the conversation's pinned messages (previews), latest pinned first. Members only.
export async function GET(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const conversation = await getConversationForUser((await params).conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    return NextResponse.json(await findPinnedMessages(conversation.pinnedMessageIds ?? []));
  } catch (error) {
    logError("pinned_messages", error);
    return new NextResponse("Error", { status: 500 });
  }
}
