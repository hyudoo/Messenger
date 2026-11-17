// How the chat lays messages out: a date divider where the day changes, and consecutive messages
// of one sender (same day, a few minutes apart) grouped under one avatar / name / time.
type Groupable = {
  createdAt: Date | string;
  sender?: { email?: string | null } | null;
  isCall?: boolean | null;
};

export const GROUP_WINDOW_MS = 5 * 60 * 1000;

const time = (value: Date | string) => new Date(value).getTime();

export const isSameDay = (a: Date | string, b: Date | string) =>
  new Date(a).toDateString() === new Date(b).toDateString();

// A divider goes before the first message and before each message on a new (local) day.
export const startsNewDay = (previous: Groupable | undefined, message: Groupable) =>
  !previous || !isSameDay(previous.createdAt, message.createdAt);

// Whether a message shows its own header (avatar, name, time) instead of continuing the previous
// one. Calls always stand alone: they read as events, not as part of a run of text.
export const startsGroup = (previous: Groupable | undefined, message: Groupable) =>
  !previous ||
  startsNewDay(previous, message) ||
  !!previous.isCall ||
  !!message.isCall ||
  previous.sender?.email !== message.sender?.email ||
  time(message.createdAt) - time(previous.createdAt) > GROUP_WINDOW_MS;
