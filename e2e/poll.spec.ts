import { expect, test } from "@playwright/test";

import { pageAs, userIds } from "./fixtures";

// A group poll: Alice asks from the composer, Bob votes and the counts change on both sides at
// once; Bob switches his vote; Alice closes it and nobody can vote any more.
test("a group poll is created, voted on live, and closed", async ({ browser }) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const bob = await pageAs(browser, "bob");

  const created = await alice.request.post("/api/conversations", {
    data: { isGroup: true, name: "E2E Poll Group", members: [{ value: ids.bob }, { value: ids.carol }] },
  });
  expect(created.ok()).toBeTruthy();
  const groupId = ((await created.json()) as { id: string }).id;
  await alice.goto(`/en/conversations/${groupId}`);
  await bob.goto(`/en/conversations/${groupId}`);

  // Alice asks
  await alice.getByRole("button", { name: "New poll" }).click();
  await alice.getByLabel("Question").fill("Where do we eat?");
  await alice.getByLabel("Option 1").fill("Pho");
  await alice.getByLabel("Option 2").fill("Pizza");
  await alice.getByRole("button", { name: "Create poll" }).click();

  // both see it; Bob votes "Pho"
  const pho = (page: typeof alice) => page.getByRole("button", { name: /Pho/ });
  const pizza = (page: typeof alice) => page.getByRole("button", { name: /Pizza/ });
  await expect(bob.getByText("Where do we eat?").first()).toBeVisible();
  await pho(bob).click();
  await expect(pho(bob)).toHaveAttribute("aria-pressed", "true");
  await expect(alice.getByText("1 person voted")).toBeVisible({ timeout: 10_000 });
  await expect(pho(alice)).toContainText("1");

  // one answer only: "Pizza" replaces "Pho"
  await pizza(bob).click();
  await expect(pizza(bob)).toHaveAttribute("aria-pressed", "true");
  await expect(pho(bob)).toHaveAttribute("aria-pressed", "false");
  await expect(pizza(alice)).toContainText("1", { timeout: 10_000 });
  await expect(alice.getByText("1 person voted")).toBeVisible();

  // Alice closes it: no more votes for anyone
  await alice.getByRole("button", { name: "Close poll" }).click();
  await expect(bob.getByText("Closed", { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect(pho(bob)).toBeDisabled();
});

// The owner (an admin) may close a poll someone else asked, and the inbox shows a poll as one.
test("a group admin closes another member's poll; the inbox marks it as a poll", async ({ browser }) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const bob = await pageAs(browser, "bob");

  const created = await alice.request.post("/api/conversations", {
    data: { isGroup: true, name: "E2E Poll Admin", members: [{ value: ids.bob }, { value: ids.carol }] },
  });
  expect(created.ok()).toBeTruthy();
  const groupId = ((await created.json()) as { id: string }).id;
  const asked = await bob.request.post(`/api/conversations/${groupId}/polls`, {
    data: { question: "Movie night?", options: ["Friday", "Saturday"] },
  });
  expect(asked.ok()).toBeTruthy();

  // a fresh inbox load (the preview comes from the server, not a socket update)
  await alice.goto(`/en/conversations/${groupId}`);
  await expect(alice.getByText("Bob E2E: 📊 Poll: Movie night?")).toBeVisible();

  // Carol is neither the asker nor an admin
  const carol = await pageAs(browser, "carol");
  await carol.goto(`/en/conversations/${groupId}`);
  await expect(carol.getByText("Movie night?").first()).toBeVisible();
  await expect(carol.getByRole("button", { name: "Close poll" })).toHaveCount(0);

  await bob.goto(`/en/conversations/${groupId}`);
  await expect(bob.getByText("Movie night?").first()).toBeVisible();
  await alice.getByRole("button", { name: "Close poll" }).click();
  await expect(alice.getByText("Closed", { exact: true })).toBeVisible({ timeout: 10_000 });
  // Bob's open chat gets it live (or, had his socket not joined the room yet, on a reload)
  await expect(async () => {
    await bob.reload();
    await expect(bob.getByText("Closed", { exact: true })).toBeVisible({ timeout: 3_000 });
  }).toPass({ timeout: 20_000 });
});
