import { describe, expect, it } from "vitest";

import { JUMBO_EMOJI_MAX, countEmojiOnly } from "@/app/libs/emoji";

describe("countEmojiOnly", () => {
  it("counts emoji, ignoring spaces between them", () => {
    expect(countEmojiOnly("👍")).toBe(1);
    expect(countEmojiOnly("😂 😂😂")).toBe(3);
    expect(countEmojiOnly("  ❤️  ")).toBe(1);
  });

  it("counts joined sequences, flags, skin tones and keycaps as one", () => {
    expect(countEmojiOnly("👨‍👩‍👧‍👦")).toBe(1);
    expect(countEmojiOnly("🇻🇳")).toBe(1);
    expect(countEmojiOnly("👍🏽")).toBe(1);
    expect(countEmojiOnly("1️⃣")).toBe(1);
  });

  it("is 0 when there is any text, or nothing", () => {
    expect(countEmojiOnly("ok 👍")).toBe(0);
    expect(countEmojiOnly("123")).toBe(0);
    expect(countEmojiOnly("©")).toBe(0); // a text symbol, not an emoji
    expect(countEmojiOnly(":)")).toBe(0);
    expect(countEmojiOnly("   ")).toBe(0);
  });
});

describe("JUMBO_EMOJI_MAX", () => {
  it("lets 1 to 3 emoji show large, not 4", () => {
    expect(countEmojiOnly("🔥🔥🔥")).toBeLessThanOrEqual(JUMBO_EMOJI_MAX);
    expect(countEmojiOnly("🔥🔥🔥🔥")).toBeGreaterThan(JUMBO_EMOJI_MAX);
  });
});
