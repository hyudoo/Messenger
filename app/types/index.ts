import { Conversation, Message, User } from "@prisma/client";

// What Prisma returns for a user: hashedPassword is omitted globally (app/libs/prismadb.ts).
export type SafeUser = Omit<User, "hashedPassword">;

export type FullMessageType = Message & {
  sender: SafeUser;
  seen: SafeUser[];
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
};
