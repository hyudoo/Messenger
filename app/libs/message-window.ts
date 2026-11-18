// Long chats: how much of the history the chat view keeps. Rows off the screen are skipped by the
// browser (content-visibility, see Body), but every loaded message still costs memory and React
// work, so a chat that keeps receiving while the user sits at the bottom drops its oldest
// messages (scrolling up loads them again).

// more than this many loaded messages, while at the bottom: trim
export const MAX_KEPT_MESSAGES = 400;
// how many of the newest a trim keeps (two pages short of the maximum, so it doesn't trim on
// every new message)
export const KEPT_AFTER_TRIM = 300;

// The newest KEPT_AFTER_TRIM messages once there are more than MAX_KEPT_MESSAGES; else the same
// array (oldest first, like the chat).
export const keepNewest = <T>(messages: T[], max = MAX_KEPT_MESSAGES, keep = KEPT_AFTER_TRIM) =>
  messages.length > max ? messages.slice(messages.length - keep) : messages;

// Scrolls an element into view, then again on the next frame: rows that were skipped
// (content-visibility) take their real height once they come near the screen, which moves the
// target after the first scroll.
export const scrollIntoViewSettled = (element: Element, options?: ScrollIntoViewOptions) => {
  element.scrollIntoView(options);
  requestAnimationFrame(() => element.scrollIntoView(options));
};
