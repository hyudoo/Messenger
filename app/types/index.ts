import { CallType, Conversation, Message, User } from "@prisma/client";

// What Prisma returns for a user: hashedPassword is omitted globally (app/libs/prismadb.ts).
export type SafeUser = Omit<User, "hashedPassword">;

// A reaction as MESSAGE_INCLUDE loads it (app/libs/message-include.ts).
export type MessageReaction = {
  emoji: string;
  userId: string;
  user: { name: string | null; email: string | null };
};

export type FullMessageType = Message & {
  sender: SafeUser;
  seen: SafeUser[];
  // missing where only a preview is loaded (the conversation list)
  reactions?: MessageReaction[];
};

export type FullConversationType = Conversation & {
  users: SafeUser[];
  messages: FullMessageType[];
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
