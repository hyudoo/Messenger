// A conversation's look (Conversation.themeColor / quickEmoji), chosen by any member and shared by
// all of them: the color of one's own bubbles and of the composer's buttons, and the emoji the
// empty composer's quick button sends. Shared by the route and the UI.

import type { CSSProperties } from "react";

import { QUICK_EMOJI, countEmojiOnly } from "./emoji";

// the colors offered, as "r g b" for the --chat-accent CSS variable (tailwind `chat` color). All
// dark enough for white text on them. The first is the default (no themeColor stored).
export const CHAT_THEMES = {
  sky: "14 165 233",
  blue: "37 99 235",
  indigo: "79 70 229",
  violet: "124 58 237",
  pink: "219 39 119",
  rose: "225 29 72",
  orange: "234 88 12",
  emerald: "5 150 105",
  teal: "13 148 136",
  slate: "71 85 105",
} as const;

export type ChatTheme = keyof typeof CHAT_THEMES;

export const DEFAULT_CHAT_THEME: ChatTheme = "sky";

export const CHAT_THEME_NAMES = Object.keys(CHAT_THEMES) as ChatTheme[];

export const isChatTheme = (value: unknown): value is ChatTheme =>
  typeof value === "string" && Object.prototype.hasOwnProperty.call(CHAT_THEMES, value);

// the stored color, or the default for none / one no longer offered
export const chatThemeOf = (value: string | null | undefined): ChatTheme =>
  isChatTheme(value) ? value : DEFAULT_CHAT_THEME;

// the style that colors a chat: put on the element around its header, messages and composer
export const chatThemeStyle = (value: string | null | undefined) =>
  ({ "--chat-accent": CHAT_THEMES[chatThemeOf(value)] }) as CSSProperties;

// the theme from a request: a known color; null / the default goes back to the default (stored as
// null); undefined when it is not one of the offered colors
export const parseChatTheme = (value: unknown): ChatTheme | null | undefined => {
  if (value === null || value === DEFAULT_CHAT_THEME) {
    return null;
  }
  return isChatTheme(value) ? value : undefined;
};

// the quick emoji from a request: exactly one emoji; null / the default goes back to the default
// (stored as null); undefined for anything else
export const parseQuickEmoji = (value: unknown): string | null | undefined => {
  if (value === null) {
    return null;
  }
  if (typeof value !== "string" || value.length > 32) {
    return undefined;
  }
  const emoji = value.trim();
  if (countEmojiOnly(emoji) !== 1) {
    return undefined;
  }
  return emoji === QUICK_EMOJI ? null : emoji;
};

// what the quick button sends in this conversation
export const quickEmojiOf = (value: string | null | undefined) => value || QUICK_EMOJI;
