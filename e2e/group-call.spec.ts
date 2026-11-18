import { expect, test } from "@playwright/test";

import { pageAs, userIds } from "./fixtures";

// A group call is a mesh (app/libs/call-mesh.ts): every two people in it have their own
// connection. Three people here, so each page holds two connections.
test("a group call: three people, one joining late, and it goes on until one is left", async ({
  browser,
}) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const bob = await pageAs(browser, "bob");
  const carol = await pageAs(browser, "carol");

  const created = await alice.request.post("/api/conversations", {
    data: {
      isGroup: true,
      name: "E2E Call Group",
      members: [{ value: ids.bob }, { value: ids.carol }],
    },
  });
  expect(created.ok()).toBeTruthy();
  const groupId = ((await created.json()) as { id: string }).id;
  const inRoom = new RegExp(`/en/room/${groupId}$`);

  await bob.goto("/en/conversations");
  await carol.goto("/en/conversations");
  await alice.goto(`/en/conversations/${groupId}`);
  await alice.getByRole("button", { name: "Video call" }).click();
  await expect(alice).toHaveURL(inRoom);
  await expect(alice.getByText("Waiting for E2E Call Group…").first()).toBeVisible();

  // it rings for both, with the group's name; Bob picks up
  await expect(carol.getByText("in E2E Call Group")).toBeVisible();
  await bob.getByRole("button", { name: "Accept" }).click();
  await expect(bob).toHaveURL(inRoom);
  for (const page of [alice, bob]) {
    await expect(page.getByText(/^\d+:\d{2} · 2 people$/)).toBeVisible({ timeout: 30_000 });
  }

  // Carol declines (only her own ringing stops), then joins from the call message in the chat
  await carol.getByRole("button", { name: "Decline" }).click();
  await expect(alice).toHaveURL(inRoom);
  await carol.goto(`/en/conversations/${groupId}`);
  await carol.getByRole("button", { name: "Join", exact: true }).click();
  await expect(carol).toHaveURL(inRoom);

  // everyone connects to everyone: three people, no tile still connecting
  for (const page of [alice, bob, carol]) {
    await expect(page.getByText(/^\d+:\d{2} · 3 people$/)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Connecting…")).toHaveCount(0, { timeout: 30_000 });
  }

  // Bob leaves: the call goes on for the other two
  await bob.getByRole("button", { name: "Leave call" }).click();
  await expect(bob).not.toHaveURL(/\/room\//);
  await expect(alice.getByText("Bob E2E left the call")).toBeVisible();
  for (const page of [alice, carol]) {
    await expect(page.getByText(/^\d+:\d{2} · 2 people$/)).toBeVisible();
    await expect(page).toHaveURL(inRoom);
  }

  // Carol leaves: Alice, alone now, leaves too
  await carol.getByRole("button", { name: "Leave call" }).click();
  await expect(alice).not.toHaveURL(/\/room\//, { timeout: 15_000 });
});
