import { describe, expect, it } from "vitest";

import {
  CHAT_THEMES,
  chatThemeOf,
  chatThemeStyle,
  parseChatTheme,
  parseQuickEmoji,
  quickEmojiOf,
} from "@/app/libs/chat-theme";

describe("chat theme", () => {
  it("parses a color: offered keys only, the default or null back to none", () => {
    expect(parseChatTheme("violet")).toBe("violet");
    expect(parseChatTheme("sky")).toBeNull();
    expect(parseChatTheme(null)).toBeNull();
    expect(parseChatTheme("#ff0000")).toBeUndefined();
    expect(parseChatTheme("toString")).toBeUndefined();
    expect(parseChatTheme(3)).toBeUndefined();
  });

  it("falls back to the default color for none or one no longer offered", () => {
    expect(chatThemeOf(null)).toBe("sky");
    expect(chatThemeOf("gone")).toBe("sky");
    expect(chatThemeOf("rose")).toBe("rose");
    expect(chatThemeStyle("rose")).toEqual({ "--chat-accent": CHAT_THEMES.rose });
  });

  it("parses a quick emoji: exactly one, 👍 or null back to none", () => {
    expect(parseQuickEmoji("❤️")).toBe("❤️");
    expect(parseQuickEmoji(" 👨‍👩‍👧 ")).toBe("👨‍👩‍👧");
    expect(parseQuickEmoji("👍")).toBeNull();
    expect(parseQuickEmoji(null)).toBeNull();
    expect(parseQuickEmoji("👍👍")).toBeUndefined();
    expect(parseQuickEmoji("a")).toBeUndefined();
    expect(parseQuickEmoji("")).toBeUndefined();
    expect(parseQuickEmoji(1)).toBeUndefined();
    expect(quickEmojiOf(null)).toBe("👍");
    expect(quickEmojiOf("🔥")).toBe("🔥");
  });
});
