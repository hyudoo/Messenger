import { CallType, Conversation, Message, User } from "@prisma/client";

// What Prisma returns for a user: hashedPassword is omitted globally (app/libs/prismadb.ts).
// a user row as queries return it (app/libs/prismadb.ts omits these fields)
export type SafeUser = Omit<
  User,
  "hashedPassword" | "mutedConversationIds" | "pinnedConversationIds" | "blockedUserIds"
>;

// A reaction as MESSAGE_INCLUDE loads it (app/libs/message-include.ts).
export type MessageReaction = {
  emoji: string;
  userId: string;
  user: { name: string | null; email: string | null };
};

// The replied-to message as shown above a reply (REPLY_PREVIEW_SELECT, app/libs/message-include.ts).
export type ReplyPreview = Pick<
  Message,
  "id" | "body" | "image" | "attachment" | "isCall" | "deletedAt"
> & {
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
  // the user's own settings (inbox only): no notifications / kept at the top
  muted?: boolean;
  pinned?: boolean;
};

// Payload of "conversation:settings": the user changed their settings of a conversation.
export type ConversationSettings = { id: string; muted: boolean; pinned: boolean };

// Payload of "conversation:update": a new message (with lastMessageAt; name / isGroup for
// notifications), a seen update (messages only) or a group change (users with name / ownerId /
// adminIds / image / inviteCode: renamed, new photo, members or admins changed, someone left).
export type ConversationUpdate = Pick<FullConversationType, "id"> &
  Partial<
    Pick<
      FullConversationType,
      | "messages"
      | "users"
      | "userIds"
      | "ownerId"
      | "adminIds"
      | "image"
      | "inviteCode"
      | "name"
      | "isGroup"
    >
  > & {
    lastMessageAt?: string;
    // the recipient muted this conversation: no notification
    muted?: boolean;
    // the message mentions the recipient (a group's "@Name")
    mentioned?: boolean;
    // the recipient read it without a read receipt (it isn't in `seen`): their count goes to 0
    read?: boolean;
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
  // a group call: the group's name (missing for 1:1 calls and re-sent calls)
  groupName?: string | null;
};
