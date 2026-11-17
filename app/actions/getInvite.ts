import prisma from "@/app/libs/prismadb";
import { isInviteCode } from "@/app/libs/invite-code";

// The group behind an invite code, as the join page shows it (name, photo, a few members, the
// count), or null when the code is malformed, was reset or turned off.
export const findInvitedGroup = async (code: unknown) => {
  if (!isInviteCode(code)) {
    return null;
  }
  return prisma.conversation.findFirst({
    where: { inviteCode: code, isGroup: true },
    include: { users: true },
  });
};
