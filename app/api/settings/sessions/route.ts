import { NextResponse } from "next/server";

import getCurrentUser from "@/app/actions/getCurrentUser";
import { rateLimit, tooManyRequests } from "@/app/libs/rate-limit";
import { reissueSession, revokeSessions } from "@/app/libs/sessions";
import { logError } from "@/app/libs/log";

// DELETE: "sign out other devices". Every session of the user ends, then this device gets a new
// session cookie, so only it stays signed in. Rate limited per user (with password changes).
export async function DELETE() {
  try {
    const currentUser = await getCurrentUser();
    if (!currentUser?.id) {
      return new NextResponse("Unauthorized", { status: 401 });
    }
    const limited = await rateLimit("passwordChange", currentUser.id);
    if (!limited.ok) {
      return tooManyRequests(limited.retryAfter);
    }

    const { user, version } = await revokeSessions(currentUser.id);
    return reissueSession(NextResponse.json({ ok: true }), user, version);
  } catch (error) {
    logError("sessions_revoke", error);
    return new NextResponse("Error", { status: 500 });
  }
}
