import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import getMessages from "@/app/actions/getMessages";

interface IParams {
  conversationId?: string;
}

const OBJECT_ID = /^[a-f\d]{24}$/i;

// GET ?before=<messageId>: the page of messages older than that message
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

    const before = new URL(request.url).searchParams.get("before");
    if (!before || !OBJECT_ID.test(before)) {
      return new NextResponse("Invalid cursor", { status: 400 });
    }

    return NextResponse.json(await getMessages(conversation.id, before));
  } catch (error) {
    console.log(error, "ERROR_MESSAGES_PAGE");
    return new NextResponse("Error", { status: 500 });
  }
}
