import { expect, test } from "@playwright/test";

import { pageAs, userIds } from "./fixtures";

test("an admin shares an invite link and someone joins with it", async ({ browser }) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const dave = await pageAs(browser, "dave");

  // a group of Alice (its owner), Bob and Carol
  const created = await alice.request.post("/api/conversations", {
    data: {
      isGroup: true,
      name: "E2E Invite Group",
      members: [{ value: ids.bob }, { value: ids.carol }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const groupId = ((await created.json()) as { id: string }).id;

  // Alice turns the invite link on in the details panel and reads it
  await alice.goto(`/en/conversations/${groupId}`);
  await alice.getByRole("button", { name: "Conversation details" }).click();
  await alice.getByRole("button", { name: "Create link" }).click();
  const linkField = alice.getByRole("textbox", { name: "Invite link" });
  await expect(linkField).toHaveValue(/\/en\/join\/[A-Za-z0-9_-]{16}$/);
  const link = await linkField.inputValue();

  // Dave opens it, sees the group and joins
  await dave.goto(link);
  await expect(dave.getByRole("heading", { name: "E2E Invite Group" })).toBeVisible();
  await dave.getByRole("button", { name: "Join group" }).click();
  await expect(dave).toHaveURL(new RegExp(`/en/conversations/${groupId}$`));

  // the members see the event in the chat
  await expect(
    alice.getByText("Dave E2E joined the group via the invite link").first()
  ).toBeVisible();

  // turning the link off makes it stop working
  await alice.getByRole("button", { name: "Turn off" }).click();
  await expect(linkField).toHaveCount(0);
  const stranger = await pageAs(browser, "dave");
  await stranger.goto(link);
  await expect(stranger.getByText("This invite link no longer works")).toBeVisible();
});
