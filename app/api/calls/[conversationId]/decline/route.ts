import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { logError } from "@/app/libs/log";
import { declineCall } from "@/server/call-log";

interface IParams {
  conversationId?: string;
}

// POST: declines the call ringing in this conversation, like the socket's call:decline. Used by
// the "Decline" button of the incoming call's push notification (public/sw.js), which may run with
// every tab closed, so without a socket. Members only.
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
    if (!globalThis.io) {
      return new NextResponse("Realtime server not running", { status: 503 });
    }
    const { conversationId } = await params;
    const declined =
      !!conversationId &&
      (await declineCall(globalThis.io, conversationId, {
        id: currentUser.id,
        email: currentUser.email,
      }));
    return declined ? new NextResponse(null, { status: 204 }) : new NextResponse("Not found", { status: 404 });
  } catch (error) {
    logError("call_decline", error);
    return new NextResponse("Error", { status: 500 });
  }
}
