import { describe, expect, it } from "vitest";

import { splitLinks } from "@/app/libs/linkify";
import { matchesSearch, normalizeSearch } from "@/app/libs/search";
import { GROUP_WINDOW_MS, startsGroup, startsNewDay } from "@/app/libs/message-groups";
import { countUnread, formatUnread } from "@/app/libs/unread";

describe("splitLinks", () => {
  it("leaves text without links alone", () => {
    expect(splitLinks("xin chào")).toEqual([{ type: "text", value: "xin chào" }]);
  });

  it("finds http(s) links between text", () => {
    expect(splitLinks("xem https://a.com/x?y=1 và http://b.vn nhé")).toEqual([
      { type: "text", value: "xem " },
      { type: "link", value: "https://a.com/x?y=1" },
      { type: "text", value: " và " },
      { type: "link", value: "http://b.vn" },
      { type: "text", value: " nhé" },
    ]);
  });

  it("keeps sentence punctuation out of the link", () => {
    expect(splitLinks("see https://a.com/page.")).toEqual([
      { type: "text", value: "see " },
      { type: "link", value: "https://a.com/page" },
      { type: "text", value: "." },
    ]);
  });

  it("keeps a closing bracket only when the URL opened one", () => {
    expect(splitLinks("(https://a.com/x)")[1]).toEqual({ type: "link", value: "https://a.com/x" });
    expect(splitLinks("https://en.wikipedia.org/wiki/Foo_(bar)")[0]).toEqual({
      type: "link",
      value: "https://en.wikipedia.org/wiki/Foo_(bar)",
    });
  });

  it("does not link bare domains or other schemes", () => {
    expect(splitLinks("hello.world javascript:alert(1)")).toEqual([
      { type: "text", value: "hello.world javascript:alert(1)" },
    ]);
  });
});

describe("search", () => {
  it("ignores case and Vietnamese diacritics", () => {
    expect(normalizeSearch("  Đỗ Ngọc HUY ")).toBe("do ngoc huy");
    expect(matchesSearch("ngoc", "Đỗ Ngọc Huy")).toBe(true);
    expect(matchesSearch("duc", "Trần Đức")).toBe(true);
  });

  it("needs every word, in any field", () => {
    expect(matchesSearch("huy gmail", "Huy", "huy@gmail.com")).toBe(true);
    expect(matchesSearch("huy yahoo", "Huy", "huy@gmail.com")).toBe(false);
  });

  it("matches everything with an empty query", () => {
    expect(matchesSearch("   ", null)).toBe(true);
  });
});

describe("message groups", () => {
  const at = (iso: string, email = "a@x.com", isCall = false) => ({
    createdAt: iso,
    sender: { email },
    isCall,
  });

  it("starts a group for the first message, another sender or a long pause", () => {
    const first = at("2026-11-17T10:00:00");
    expect(startsGroup(undefined, first)).toBe(true);
    expect(startsGroup(first, at("2026-11-17T10:01:00"))).toBe(false);
    expect(startsGroup(first, at("2026-11-17T10:01:00", "b@x.com"))).toBe(true);
    const later = new Date(new Date(first.createdAt).getTime() + GROUP_WINDOW_MS + 1000);
    expect(startsGroup(first, at(later.toISOString()))).toBe(true);
  });

  it("never groups calls", () => {
    const first = at("2026-11-17T10:00:00");
    expect(startsGroup(first, at("2026-11-17T10:00:30", "a@x.com", true))).toBe(true);
    expect(startsGroup(at("2026-11-17T10:00:00", "a@x.com", true), at("2026-11-17T10:00:30"))).toBe(
      true
    );
  });

  it("puts a divider where the local day changes", () => {
    expect(startsNewDay(undefined, at("2026-11-17T10:00:00"))).toBe(true);
    expect(startsNewDay(at("2026-11-17T10:00:00"), at("2026-11-17T23:00:00"))).toBe(false);
    expect(startsNewDay(at("2026-11-17T23:59:00"), at("2026-11-18T00:01:00"))).toBe(true);
    // a new day also starts a new group, however close in time
    expect(startsGroup(at("2026-11-17T23:59:00"), at("2026-11-18T00:01:00"))).toBe(true);
  });
});

describe("countUnread", () => {
  const ME = "me";
  const from = (senderId: string, seenIds: string[] = [senderId]) => ({ senderId, seenIds });

  it("counts others' messages back to the newest one the user saw", () => {
    // newest first
    expect(countUnread([from("a"), from("b"), from("a", ["a", ME]), from("a")], ME)).toBe(2);
  });

  it("stops at the user's own message", () => {
    expect(countUnread([from("a"), from(ME), from("a")], ME)).toBe(1);
  });

  it("is 0 when the newest message was seen", () => {
    expect(countUnread([from("a", ["a", ME]), from("a")], ME)).toBe(0);
    expect(countUnread([], ME)).toBe(0);
  });

  it("caps the label at 99+", () => {
    expect(formatUnread(7)).toBe("7");
    expect(formatUnread(100)).toBe("99+");
  });
});
