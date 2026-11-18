import { describe, expect, it } from "vitest";

import { splitLinks } from "@/app/libs/linkify";
import { KEPT_AFTER_TRIM, MAX_KEPT_MESSAGES, keepNewest } from "@/app/libs/message-window";
import {
  findFoldedMatch,
  matchesSearch,
  normalizeSearch,
  searchTextOf,
} from "@/app/libs/search";
import { GROUP_WINDOW_MS, startsGroup, startsNewDay } from "@/app/libs/message-groups";
import { countUnread, findFirstUnread, formatUnread, hasRead } from "@/app/libs/unread";
import { findMentions, mentionQueryAt, splitMentions } from "@/app/libs/mentions";
import {
  canEditGroup,
  canManageAdmins,
  canManageInvite,
  canRemoveMember,
  isGroupAdmin,
  normalizeGroupName,
} from "@/app/libs/conversation-permissions";
import { isInviteCode, safeNextPath } from "@/app/libs/invite-code";
import {
  canEditMessage,
  canRecallMessage,
  canForwardMessage,
  canReactToMessage,
  canReplyToMessage,
} from "@/app/libs/message-actions";

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

  it("never groups group events", () => {
    const first = at("2026-11-17T10:00:00");
    const event = { ...at("2026-11-17T10:00:30"), systemType: "renamed" };
    expect(startsGroup(first, event)).toBe(true);
    expect(startsGroup(event, at("2026-11-17T10:00:40"))).toBe(true);
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

  it("finds where the new messages start (oldest first)", () => {
    const page = [
      { id: "1", ...from("a", ["a", ME]) },
      { id: "2", ...from("b") },
      { id: "3", ...from("a") },
    ];
    expect(findFirstUnread(page, ME)).toBe("2");
    expect(findFirstUnread([...page, { id: "4", ...from(ME) }], ME)).toBeNull();
    expect(findFirstUnread([], ME)).toBeNull();
  });

  it("caps the label at 99+", () => {
    expect(formatUnread(7)).toBe("7");
    expect(formatUnread(100)).toBe("99+");
  });
});

describe("message actions", () => {
  const message = (extra: Record<string, unknown> = {}) => ({
    senderId: "me",
    body: "hi",
    isCall: null,
    deletedAt: null,
    createdAt: new Date("2026-11-17T10:00:00Z"),
    ...extra,
  });
  const at = (minutes: number) => new Date("2026-11-17T10:00:00Z").getTime() + minutes * 60_000;

  it("edits only one's own text within the window", () => {
    expect(canEditMessage(message(), "me", at(14))).toBe(true);
    expect(canEditMessage(message(), "me", at(16))).toBe(false);
    expect(canEditMessage(message(), "other", at(1))).toBe(false);
    expect(canEditMessage(message({ body: null }), "me", at(1))).toBe(false);
    expect(canEditMessage(message({ deletedAt: new Date() }), "me", at(1))).toBe(false);
  });

  it("recalls one's own messages but not calls, once", () => {
    expect(canRecallMessage(message(), "me")).toBe(true);
    expect(canRecallMessage(message(), "other")).toBe(false);
    expect(canRecallMessage(message({ isCall: true }), "me")).toBe(false);
    expect(canRecallMessage(message({ deletedAt: new Date() }), "me")).toBe(false);
  });

  it("replies to anything still there", () => {
    expect(canReplyToMessage(message({ senderId: "other" }))).toBe(true);
    expect(canReplyToMessage(message({ deletedAt: new Date() }))).toBe(false);
  });

  it("forwards a person's message with content", () => {
    expect(canForwardMessage(message({ senderId: "other" }))).toBe(true);
    expect(canForwardMessage({ ...message(), body: null, image: "x" })).toBe(true);
    expect(canForwardMessage({ ...message(), body: null })).toBe(false);
    expect(canForwardMessage(message({ isCall: true }))).toBe(false);
    expect(canForwardMessage(message({ systemType: "left" }))).toBe(false);
  });

  it("reacts to anything still there except a call", () => {
    expect(canReactToMessage(message({ senderId: "other" }))).toBe(true);
    expect(canReactToMessage(message({ deletedAt: new Date() }))).toBe(false);
    expect(canReactToMessage(message({ isCall: true }))).toBe(false);
    expect(canReactToMessage(message({ systemType: "added" }))).toBe(false);
    expect(canReplyToMessage(message({ systemType: "added" }))).toBe(false);
  });
});

describe("group permissions", () => {
  const group = (ownerId: string | null) => ({ isGroup: true, ownerId });

  it("lets any group member edit, never a 1:1 chat", () => {
    expect(canEditGroup(group("other"))).toBe(true);
    expect(canEditGroup({ isGroup: null })).toBe(false);
  });

  it("lets the owner (or anyone in an ownerless group) remove someone else", () => {
    expect(canRemoveMember(group("me"), "me", "other")).toBe(true);
    expect(canRemoveMember(group("other"), "me", "third")).toBe(false);
    expect(canRemoveMember(group(null), "me", "other")).toBe(true);
    expect(canRemoveMember(group("me"), "me", "me")).toBe(false);
    expect(canRemoveMember({ isGroup: false, ownerId: null }, "me", "other")).toBe(false);
  });

  it("knows admins: the owner, the picked ones, anyone in an ownerless group", () => {
    const withAdmins = { isGroup: true, ownerId: "owner", adminIds: ["admin"] };
    expect(isGroupAdmin(withAdmins, "owner")).toBe(true);
    expect(isGroupAdmin(withAdmins, "admin")).toBe(true);
    expect(isGroupAdmin(withAdmins, "member")).toBe(false);
    expect(isGroupAdmin(group(null), "member")).toBe(true);
    expect(isGroupAdmin({ isGroup: false, ownerId: null }, "member")).toBe(false);
    expect(canManageInvite(withAdmins, "admin")).toBe(true);
  });

  it("lets admins remove members, only the owner remove admins, nobody the owner", () => {
    const withAdmins = { isGroup: true, ownerId: "owner", adminIds: ["admin", "admin2"] };
    expect(canRemoveMember(withAdmins, "admin", "member")).toBe(true);
    expect(canRemoveMember(withAdmins, "admin", "admin2")).toBe(false);
    expect(canRemoveMember(withAdmins, "admin", "owner")).toBe(false);
    expect(canRemoveMember(withAdmins, "owner", "admin")).toBe(true);
    expect(canRemoveMember(withAdmins, "member", "other")).toBe(false);
  });

  it("lets only the owner change admins, never their own role", () => {
    expect(canManageAdmins(group("owner"), "owner", "member")).toBe(true);
    expect(canManageAdmins(group("owner"), "owner", "owner")).toBe(false);
    expect(canManageAdmins({ ...group("owner"), adminIds: ["admin"] }, "admin", "member")).toBe(false);
    expect(canManageAdmins(group(null), "member", "other")).toBe(false);
  });

  it("normalizes a group name", () => {
    expect(normalizeGroupName("  Team ")).toBe("Team");
    expect(normalizeGroupName("   ")).toBeNull();
    expect(normalizeGroupName(42)).toBeNull();
    expect(normalizeGroupName("x".repeat(101))).toBeNull();
  });
});

describe("message search folding", () => {
  it("folds a body like the inbox search", () => {
    expect(searchTextOf("Xin Chào ĐỨC")).toBe("xin chao duc");
    expect(searchTextOf("   ")).toBeUndefined();
    expect(searchTextOf(null)).toBeUndefined();
  });

  it("finds the match in the original text, ignoring case and diacritics", () => {
    const text = "Hẹn gặp Đức lúc 5h nhé";
    const match = findFoldedMatch(text, "duc luc")!;
    expect(text.slice(...match)).toBe("Đức lúc");
    expect(findFoldedMatch(text, "HEN")).toEqual([0, 3]);
    expect(findFoldedMatch(text, "xyz")).toBeNull();
    expect(findFoldedMatch(text, "  ")).toBeNull();
  });

  it("keeps whole characters around emoji", () => {
    const text = "😀 chào";
    expect(text.slice(...findFoldedMatch(text, "chao")!)).toBe("chào");
  });
});

describe("mentions", () => {
  const members = [
    { id: "a", name: "Huy", email: "a@x" },
    { id: "b", name: "Huy Do", email: "b@x" },
    { id: "c", name: "An", email: "c@x" },
  ];

  it("finds members named as @Name, longest name first, not the sender", () => {
    expect(findMentions("@Huy Do ơi, @An!", members, "a").map((m) => m.id)).toEqual(["b", "c"]);
    expect(findMentions("hi @Huy.", members).map((m) => m.id)).toEqual(["a"]);
    expect(findMentions("@An", members, "c")).toEqual([]);
  });

  it("ignores names inside other words or e-mails", () => {
    expect(findMentions("@Annie", members)).toEqual([]);
    expect(findMentions("mail@An", members)).toEqual([]);
    expect(findMentions("no at sign", members)).toEqual([]);
  });

  it("cuts the text around its mentions", () => {
    const mention = { id: "b", name: "Huy Do", email: "b@x" };
    expect(splitMentions("hey @Huy Do, ok", [mention])).toEqual([
      { type: "text", value: "hey " },
      { type: "mention", value: "@Huy Do", mention },
      { type: "text", value: ", ok" },
    ]);
    expect(splitMentions("plain", [])).toEqual([{ type: "text", value: "plain" }]);
  });

  it("finds the @word being typed before the caret", () => {
    expect(mentionQueryAt("hi @hu", 6)).toEqual({ start: 3, query: "hu" });
    expect(mentionQueryAt("@", 1)).toEqual({ start: 0, query: "" });
    expect(mentionQueryAt("mail@x", 6)).toBeNull();
    expect(mentionQueryAt("@huy do", 7)).toBeNull();
  });
});

describe("invite codes", () => {
  it("accepts only 16 base64url characters", () => {
    expect(isInviteCode("AbCdEfGhIjKlMn_-")).toBe(true);
    expect(isInviteCode("short")).toBe(false);
    expect(isInviteCode("AbCdEfGhIjKlMn_/")).toBe(false);
    expect(isInviteCode(42)).toBe(false);
  });

  it("only lets the login page go back to a join page", () => {
    expect(safeNextPath("/join/AbCdEfGhIjKlMn_-")).toBe("/join/AbCdEfGhIjKlMn_-");
    expect(safeNextPath("//evil.example/join/AbCdEfGhIjKlMn_-")).toBeNull();
    expect(safeNextPath("https://evil.example")).toBeNull();
    expect(safeNextPath("/conversations")).toBeNull();
    expect(safeNextPath(["/join/AbCdEfGhIjKlMn_-"])).toBeNull();
  });
});

describe("private reads", () => {
  it("count a read kept without a receipt as the read marker", () => {
    expect(hasRead({ senderId: "x", seenIds: [], privateSeenIds: ["me"] }, "me")).toBe(true);
    expect(hasRead({ senderId: "x", seenIds: [] }, "me")).toBe(false);
    const newestFirst = [
      { senderId: "x", seenIds: [] },
      { senderId: "x", seenIds: [], privateSeenIds: ["me"] },
      { senderId: "x", seenIds: [] },
    ];
    expect(countUnread(newestFirst, "me")).toBe(1);
  });
});

describe("keepNewest (long chats)", () => {
  it("keeps the same array up to the maximum", () => {
    const messages = Array.from({ length: MAX_KEPT_MESSAGES }, (_, i) => i);
    expect(keepNewest(messages)).toBe(messages);
  });

  it("keeps only the newest past the maximum, in order", () => {
    const messages = Array.from({ length: MAX_KEPT_MESSAGES + 1 }, (_, i) => i);
    const kept = keepNewest(messages);
    expect(kept).toHaveLength(KEPT_AFTER_TRIM);
    expect(kept[0]).toBe(MAX_KEPT_MESSAGES + 1 - KEPT_AFTER_TRIM);
    expect(kept[kept.length - 1]).toBe(MAX_KEPT_MESSAGES);
  });
});
