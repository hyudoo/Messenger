import { CallType, Conversation, Message, User } from "@prisma/client";

// What Prisma returns for a user: hashedPassword is omitted globally (app/libs/prismadb.ts).
export type SafeUser = Omit<User, "hashedPassword">;

// A reaction as MESSAGE_INCLUDE loads it (app/libs/message-include.ts).
export type MessageReaction = {
  emoji: string;
  userId: string;
  user: { name: string | null; email: string | null };
};

// The replied-to message as shown above a reply (REPLY_PREVIEW_SELECT, app/libs/message-include.ts).
export type ReplyPreview = Pick<Message, "id" | "body" | "image" | "isCall" | "deletedAt"> & {
  sender: { name: string | null; email: string | null };
};

export type FullMessageType = Message & {
  sender: SafeUser;
  seen: SafeUser[];
  // missing where only a preview is loaded (the conversation list)
  reactions?: MessageReaction[];
  // missing where only a preview is loaded (the conversation list)
  replyTo?: ReplyPreview | null;
  // messages:new only: the sending tab's outbox id (app/hooks/useOutbox.ts)
  clientId?: string;
};

export type FullConversationType = Conversation & {
  users: SafeUser[];
  messages: FullMessageType[];
  // messages from others the user hasn't seen (inbox only; missing on socket payloads)
  unreadCount?: number;
};

// Payload of "conversation:update": a new message (with lastMessageAt; name / isGroup for
// notifications), a seen update (messages only) or a group change (users with name / ownerId:
// renamed, members added or removed, someone left).
export type ConversationUpdate = Pick<FullConversationType, "id"> &
  Partial<
    Pick<FullConversationType, "messages" | "users" | "userIds" | "ownerId" | "name" | "isGroup">
  > & {
    lastMessageAt?: string;
  };

export type ConversationWithUsers = Conversation & {
  users: SafeUser[];
};

// Payload of the "call:incoming" socket event
export type FullCallType = {
  id: string;
  user: SafeUser;
  // missing from servers older than audio calls: video
  callType?: CallType | null;
};
