import { NextResponse } from "next/server";

import getConversationForUser from "@/app/actions/getConversationForUser";
import getCurrentUser from "@/app/actions/getCurrentUser";
import { canManageInvite } from "@/app/libs/conversation-permissions";
import prisma from "@/app/libs/prismadb";
import { logError } from "@/app/libs/log";

interface IParams {
  conversationId?: string;
}

// GET: who is waiting for an admin's approval to join by the invite link (oldest first), for
// GroupInvite. Admins only.
export async function GET(request: Request, { params }: { params: Promise<IParams> }) {
  try {
    const { conversationId } = await params;
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const conversation = await getConversationForUser(conversationId, currentUser.id);
    if (!conversation) {
      return new NextResponse("Not found", { status: 404 });
    }
    if (!canManageInvite(conversation, currentUser.id)) {
      return new NextResponse("Only group admins can see join requests", { status: 403 });
    }

    const ids = conversation.joinRequestIds ?? [];
    const users =
      ids.length > 0
        ? await prisma.user.findMany({
            where: { id: { in: ids } },
            select: { id: true, name: true, email: true, image: true },
          })
        : [];
    // in the order they asked
    const order = new Map(ids.map((id, index) => [id, index]));
    return NextResponse.json(
      users.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0))
    );
  } catch (error) {
    logError("join_requests", error);
    return new NextResponse("Error", { status: 500 });
  }
}
