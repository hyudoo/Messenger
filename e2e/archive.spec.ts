import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";
import { conversationWith, pageAs, send, userIds } from "./fixtures";

// Archiving a chat from its drawer takes it out of the inbox list (under "Archived"); a new message
// brings it back, live and for good (the server unarchived it too: still there after a reload).
test("an archived chat leaves the inbox list and comes back with a new message", async ({ browser }) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const carol = await pageAs(browser, "carol");
  const conversationId = await conversationWith(alice, ids.carol);

  await carol.goto(`/en/conversations/${conversationId}`);
  await send(carol, "before archiving");

  await alice.goto(`/en/conversations/${conversationId}`);
  const inboxItem = alice
    .getByRole("link", { name: new RegExp(E2E_USERS.carol.name) })
    .filter({ hasText: /archiving|again/ });
  await expect(inboxItem).toBeVisible();

  await alice.getByRole("button", { name: "Conversation details" }).click();
  await alice.getByRole("button", { name: "Archive", exact: true }).click();
  await expect(alice.getByRole("button", { name: "Unarchive" })).toBeVisible();
  await alice.keyboard.press("Escape");

  // out of the list, counted under "Archived" (and listed there once unfolded)
  await expect(inboxItem).toBeHidden();
  const archived = alice.getByRole("button", { name: /^Archived \(\d+\)$/ });
  await expect(archived).toBeVisible();
  await archived.click();
  await expect(inboxItem).toBeVisible();
  await archived.click();
  await expect(inboxItem).toBeHidden();

  // Carol writes again: back in Alice's list at once, and after a reload
  await send(carol, "writing again");
  await expect(inboxItem).toBeVisible({ timeout: 10_000 });
  await alice.reload();
  await expect(inboxItem).toBeVisible();
  await expect(alice.getByRole("button", { name: /^Archived/ })).toBeHidden();
});
