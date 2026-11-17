// Who may edit or recall a message, shared by PATCH / DELETE /api/messages/[messageId] and
// MessageBox, so the UI only offers what the server allows.
type Actionable = {
  senderId: string;
  body?: string | null;
  isCall?: boolean | null;
  deletedAt?: Date | string | null;
  createdAt: Date | string;
};

// like Messenger: a typo can be fixed for a while, not history rewritten later
export const EDIT_WINDOW_MS = 15 * 60 * 1000;

const isLive = (message: Actionable) => !message.deletedAt && !message.isCall;

// The sender's own text message, not recalled, within EDIT_WINDOW_MS of sending.
export const canEditMessage = (message: Actionable, userId: string, now = Date.now()) =>
  isLive(message) &&
  message.senderId === userId &&
  !!message.body &&
  now - new Date(message.createdAt).getTime() <= EDIT_WINDOW_MS;

// The sender's own message (text or image, not a call), at any time, once.
export const canRecallMessage = (message: Actionable, userId: string) =>
  isLive(message) && message.senderId === userId;

// Anyone in the conversation may reply to a message that is still there.
export const canReplyToMessage = (message: Actionable) => isLive(message);

// Anyone in the conversation may react to a message that is still there, but not to a call.
export const canReactToMessage = (message: Pick<Actionable, "isCall" | "deletedAt">) =>
  !message.deletedAt && !message.isCall;
