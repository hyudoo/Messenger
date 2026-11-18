import { describe, expect, it } from "vitest";

import { OPTIMISTIC_USER_ID, toggleReaction } from "@/app/libs/reaction-toggle";

const me = { email: "me@x.com", name: "Me" };
const other = { emoji: "❤️", userId: "u2", user: { name: "Ann", email: "ann@x.com" } };

describe("toggleReaction", () => {
  it("adds the user's reaction last", () => {
    expect(toggleReaction([other], me, "👍")).toEqual([
      other,
      { emoji: "👍", userId: OPTIMISTIC_USER_ID, user: { name: "Me", email: "me@x.com" } },
    ]);
  });

  it("removes it when the same emoji is chosen again", () => {
    const mine = { emoji: "👍", userId: "u1", user: { name: "Me", email: "me@x.com" } };
    expect(toggleReaction([mine, other], me, "👍")).toEqual([other]);
  });

  it("replaces another emoji and keeps the user's id", () => {
    const mine = { emoji: "👍", userId: "u1", user: { name: "Me", email: "me@x.com" } };
    expect(toggleReaction([mine, other], me, "😂")).toEqual([
      other,
      { emoji: "😂", userId: "u1", user: { name: "Me", email: "me@x.com" } },
    ]);
  });
});
