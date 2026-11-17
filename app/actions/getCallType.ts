import { CallType } from "@prisma/client";

import prisma from "@/app/libs/prismadb";

// The kind of the conversation's latest call, which is the call being joined:
// the caller posts the call message before opening the room and the callee
// accepts the call that rang. Both peers read it here, so they always agree.
// Calls from before audio calls existed have no callType: video.
const getCallType = async (conversationId: string): Promise<CallType> => {
  try {
    const call = await prisma.message.findFirst({
      where: { conversationId, isCall: true },
      orderBy: { createdAt: "desc" },
      select: { callType: true },
    });
    return call?.callType ?? "video";
  } catch {
    return "video";
  }
};

export default getCallType;
