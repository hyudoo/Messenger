import { describe, expect, it } from "vitest";

import { displayName, nicknameOf, parseNickname, withNickname } from "@/app/libs/nicknames";

describe("nicknames", () => {
  it("parses a nickname: trimmed, spaces collapsed, empty or null removes, too long refused", () => {
    expect(parseNickname("  Big   Bro ")).toBe("Big Bro");
    expect(parseNickname("")).toBeNull();
    expect(parseNickname("   ")).toBeNull();
    expect(parseNickname(null)).toBeNull();
    expect(parseNickname("x".repeat(41))).toBeUndefined();
    expect(parseNickname(42)).toBeUndefined();
  });

  it("sets, replaces and removes one member's nickname, keeping the others", () => {
    const list = [
      { userId: "a", nickname: "A" },
      { userId: "b", nickname: "B" },
    ];
    expect(withNickname(list, "a", "Alpha")).toEqual([
      { userId: "b", nickname: "B" },
      { userId: "a", nickname: "Alpha" },
    ]);
    expect(withNickname(list, "b", null)).toEqual([{ userId: "a", nickname: "A" }]);
  });

  it("names a member by their nickname here, else their name", () => {
    const list = [{ userId: "a", nickname: "Alpha" }];
    expect(nicknameOf(list, "a")).toBe("Alpha");
    expect(nicknameOf(list, "b")).toBeNull();
    expect(displayName({ id: "a", name: "Ann" }, list)).toBe("Alpha");
    expect(displayName({ id: "b", name: "Bob" }, list)).toBe("Bob");
    expect(displayName({ id: "b", name: "Bob" }, undefined)).toBe("Bob");
    expect(displayName(null, list)).toBeNull();
  });
});
