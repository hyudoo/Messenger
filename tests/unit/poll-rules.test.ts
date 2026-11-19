import { describe, expect, it } from "vitest";

import {
  canClosePoll,
  nextPicks,
  parseNewPoll,
  parseVote,
  tallyPoll,
  type PollView,
} from "@/app/libs/poll-rules";

const poll = (multiple: boolean, votes: PollView["votes"] = []): PollView => ({
  id: "p",
  question: "Lunch?",
  options: [
    { id: "a", text: "Pho" },
    { id: "b", text: "Bun cha" },
    { id: "c", text: "Pizza" },
  ],
  multiple,
  closedAt: null,
  votes,
});

describe("parseNewPoll", () => {
  it("trims, drops empty options, keeps the order", () => {
    expect(parseNewPoll({ question: "  Lunch   today? ", options: [" Pho ", "", "Pizza"], multiple: true })).toEqual({
      question: "Lunch today?",
      options: ["Pho", "Pizza"],
      multiple: true,
    });
  });

  it("refuses too few or too many options, repeats, and long or missing text", () => {
    expect(parseNewPoll({ question: "Q", options: ["only one"] })).toBeNull();
    expect(parseNewPoll({ question: "Q", options: Array.from({ length: 11 }, (_, i) => `o${i}`) })).toBeNull();
    expect(parseNewPoll({ question: "Q", options: ["Pho", "pho"] })).toBeNull();
    expect(parseNewPoll({ question: "Q", options: ["a", "x".repeat(101)] })).toBeNull();
    expect(parseNewPoll({ question: " ", options: ["a", "b"] })).toBeNull();
    expect(parseNewPoll(null)).toBeNull();
  });
});

describe("parseVote", () => {
  it("takes known options, one unless several are allowed, and an empty list", () => {
    expect(parseVote(poll(false), ["a"])).toEqual(["a"]);
    expect(parseVote(poll(false), [])).toEqual([]);
    expect(parseVote(poll(false), ["a", "b"])).toBeNull();
    expect(parseVote(poll(true), ["a", "b", "a"])).toEqual(["a", "b"]);
    expect(parseVote(poll(true), ["zzz"])).toBeNull();
    expect(parseVote(poll(true), "a")).toBeNull();
  });
});

describe("tallyPoll / nextPicks", () => {
  const votes = [
    { optionId: "a", userId: "u1" },
    { optionId: "b", userId: "u1" },
    { optionId: "a", userId: "u2" },
  ];

  it("counts votes per option, voters once each, and the user's picks", () => {
    const { counts, voters, mine } = tallyPoll(poll(true, votes), "u1");
    expect(counts.get("a")).toEqual(["u1", "u2"]);
    expect(counts.get("c")).toEqual([]);
    expect(voters).toBe(2);
    expect(Array.from(mine).sort()).toEqual(["a", "b"]);
  });

  it("switches or takes back a single choice, toggles a multiple one", () => {
    expect(nextPicks(poll(false), new Set(["a"]), "b")).toEqual(["b"]);
    expect(nextPicks(poll(false), new Set(["a"]), "a")).toEqual([]);
    expect(nextPicks(poll(true), new Set(["a"]), "b")).toEqual(["a", "b"]);
    expect(nextPicks(poll(true), new Set(["a", "b"]), "a")).toEqual(["b"]);
  });
});

describe("canClosePoll", () => {
  const group = { isGroup: true, ownerId: "owner", adminIds: ["admin"] };
  it("lets whoever asked and the admins close it, nobody else", () => {
    expect(canClosePoll(group, { senderId: "asker" }, "asker")).toBe(true);
    expect(canClosePoll(group, { senderId: "asker" }, "admin")).toBe(true);
    expect(canClosePoll(group, { senderId: "asker" }, "owner")).toBe(true);
    expect(canClosePoll(group, { senderId: "asker" }, "member")).toBe(false);
  });
});
