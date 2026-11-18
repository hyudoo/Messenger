import { SystemType } from "@prisma/client";
import { unarchiveConversation } from "./archive";

import prisma from "./prismadb";
import { MESSAGE_INCLUDE } from "./message-include";
import { emitToConversation, emitToUser } from "./socket-server";
import { logError } from "./log";
import { ConversationWithUsers } from "@/app/types";

type Person = { id: string; name: string | null; email: string | null };

interface SystemMessageOptions {
  // the conversation as it is now: its members are told
  conversation: ConversationWithUsers;
  // who did it (the message's sender)
  actorId: string;
  type: SystemType;
  // the group's name (created / renamed)
  name?: string | null;
  // who was added / removed
  users?: Person[];
  // members who see it as already read besides the actor: the people added, for whom it is the
  // read marker (so the history from before they joined doesn't count as unread for them)
  seenBy?: string[];
}

// Posts a group event ("X renamed the group", "X added Y") as a message of the conversation: it
// shows in the chat (messages:new) and as the inbox preview (conversation:update), like a new
// message, but without a push. The text is written by the client (useSystemText) in the
// reader's language. Never throws: the change it reports has already happened.
export const postSystemMessage = async ({
  conversation,
  actorId,
  type,
  name,
  users = [],
  seenBy = [],
}: SystemMessageOptions) => {
  try {
    const message = await prisma.message.create({
      include: MESSAGE_INCLUDE,
      data: {
        conversationId: conversation.id,
        senderId: actorId,
        systemType: type,
        systemName: name ?? undefined,
        systemUsers: users.map(({ id, name, email }) => ({ id, name, email })),
        seenIds: Array.from(new Set([actorId, ...seenBy])),
      },
    });
    const { lastMessageAt } = await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: message.createdAt },
      select: { lastMessageAt: true },
    });
    await unarchiveConversation(conversation.id);

    emitToConversation(conversation.id, "messages:new", message);
    conversation.users.forEach((user) => {
      if (user.email) {
        emitToUser(user.email, "conversation:update", {
          id: conversation.id,
          lastMessageAt,
          messages: [message],
          name: conversation.name,
          isGroup: conversation.isGroup,
        });
      }
    });
    return message;
  } catch (error) {
    logError("system_message", error, { type });
    return null;
  }
};
