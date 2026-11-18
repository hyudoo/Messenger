import prisma from "./prismadb";
import { emitToConversation, emitToUser } from "./socket-server";
import { pushIncomingCall, pushNewMessage } from "./message-push";
import { ConversationWithUsers, FullMessageType } from "@/app/types";

// the sender tab's outbox id (app/hooks/useOutbox.ts); only echoed back
const CLIENT_ID = /^[\w-]{1,64}$/;

interface DeliverOptions {
  conversation: ConversationWithUsers;
  sender: { id: string; email: string | null; name: string | null; image: string | null };
  message: FullMessageType;
  clientId?: unknown;
}

// Members who muted the conversation (their own setting, not on the user rows sent around).
const mutedMembers = async (conversation: ConversationWithUsers) => {
  const rows = await prisma.user.findMany({
    where: { id: { in: conversation.userIds }, mutedConversationIds: { has: conversation.id } },
    select: { id: true },
  });
  return new Set(rows.map((row) => row.id));
};

// After a new message is saved (sent, or forwarded): it becomes the conversation's last message,
// goes to the chat (messages:new) and to every member's inbox (conversation:update), rings the
// others for a call, and is pushed to the others' browsers. A muted conversation gets no push and
// no in-tab notification (`muted` in the update) except for the people it mentions; calls still
// ring.
export const deliverMessage = async ({ conversation, sender, message, clientId }: DeliverOptions) => {
  const { lastMessageAt } = await prisma.conversation.update({
    where: { id: conversation.id },
    data: { lastMessageAt: message.createdAt },
    select: { lastMessageAt: true },
  });

  // clientId lets the sending tab swap its optimistic copy for this message, whichever of the
  // socket event and the HTTP response arrives first
  emitToConversation(conversation.id, "messages:new", {
    ...message,
    ...(typeof clientId === "string" && CLIENT_ID.test(clientId) && { clientId }),
  });

  const mentioned = new Set((message.mentions ?? []).map((mention) => mention.id));
  const muted = await mutedMembers(conversation).catch(() => new Set<string>());
  mentioned.forEach((id) => muted.delete(id));
  conversation.users.forEach((user) => {
    if (!user.email) {
      return;
    }
    if (message.isCall && user.id !== sender.id) {
      emitToUser(user.email, "call:incoming", {
        id: conversation.id,
        user: sender,
        callType: message.callType,
        // a group call rings with the group's name too
        ...(conversation.isGroup && { groupName: conversation.name }),
      });
    }
    emitToUser(user.email, "conversation:update", {
      id: conversation.id,
      lastMessageAt,
      messages: [message],
      // for the desktop notification's title (MessageNotifications)
      name: conversation.name,
      isGroup: conversation.isGroup,
      ...(muted.has(user.id) && { muted: true }),
      ...(mentioned.has(user.id) && { mentioned: true }),
    });
  });

  // Web Push to the others' browsers, for when their tabs are closed (in the background: it never
  // fails or holds up the send). A call's push lasts only while it rings; a missed call gets its
  // own (server/call-log.ts).
  const others = conversation.users.map((user) => user.id).filter((id) => id !== sender.id);
  const push = { conversation, sender };
  if (message.isCall) {
    void pushIncomingCall({
      ...push,
      recipientIds: others,
      callType: message.callType,
      startedAt: message.createdAt,
    });
  } else {
    void pushNewMessage({
      ...push,
      recipientIds: others.filter((id) => !muted.has(id)),
      mentionedIds: Array.from(mentioned),
      body: message.body,
      image: message.image,
      attachment: message.attachment,
    });
  }
};
