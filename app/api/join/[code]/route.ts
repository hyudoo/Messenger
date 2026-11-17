import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { findInvitedGroup } from "@/app/actions/getInvite";
import { joinGroup } from "@/app/libs/conversation-members";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";

interface IParams {
  code?: string;
}

// POST: joins the group behind an invite link (any signed-in user while the link is on). Already a
// member: nothing changes. Returns { conversationId } for the page to open.
export async function POST(
  request: Request,
  { params }: { params: Promise<IParams> }
) {
  try {
    const { code } = await params;
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }

    // also slows down guessing codes
    const limited = await rateLimit("conversation", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const group = await findInvitedGroup(code);
    if (!group) {
      return new NextResponse("Invalid or expired link", { status: 404 });
    }
    if (!group.userIds.includes(currentUser.id)) {
      await joinGroup(group, currentUser);
    }
    return NextResponse.json({ conversationId: group.id });
  } catch (error) {
    logError("conversation_join", error);
    return new NextResponse("Error", { status: 500 });
  }
}
