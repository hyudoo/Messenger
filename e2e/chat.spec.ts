import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";
import { chatMessage, pageAs, send } from "./fixtures";

test("two people chat in real time", async ({ browser }) => {
  const alice = await pageAs(browser, "alice");
  const bob = await pageAs(browser, "bob");

  // Bob waits in his inbox
  await bob.goto("/en/conversations");

  // Alice finds Bob on the contacts page ("Find people": they aren't friends) and writes
  await alice.goto("/en/users");
  await alice.getByPlaceholder(/find people/i).fill(E2E_USERS.bob.name);
  await alice.getByRole("button", { name: new RegExp(E2E_USERS.bob.name) }).first().click();
  await expect(alice).toHaveURL(/\/en\/conversations\/[a-f\d]{24}$/);
  await send(alice, "Hello Bob from E2E");
  await expect(chatMessage(alice, "Hello Bob from E2E")).toBeVisible();

  // the conversation and its preview reach Bob's inbox without a reload
  const preview = bob.getByRole("link", { name: /Hello Bob from E2E/ });
  await expect(preview).toBeVisible();
  await preview.click();
  await expect(bob).toHaveURL(/\/en\/conversations\/[a-f\d]{24}$/);

  // Bob answers; Alice sees it in the open chat
  await send(bob, "Hi Alice, got it");
  await expect(chatMessage(alice, "Hi Alice, got it")).toBeVisible();

  // and Bob's reply survives a reload (stored, not only pushed)
  await alice.reload();
  await expect(chatMessage(alice, "Hi Alice, got it")).toBeVisible();

  // Alice deletes her first message for herself: gone for her after a reload, still there for Bob
  const elementId = await chatMessage(alice, "Hello Bob from E2E").getAttribute("id");
  const messageId = elementId!.replace("message-", "");
  const hidden = await alice.request.delete(`/api/messages/${messageId}?scope=me`);
  expect(hidden.ok()).toBeTruthy();
  await alice.reload();
  await expect(chatMessage(alice, "Hi Alice, got it")).toBeVisible();
  await expect(chatMessage(alice, "Hello Bob from E2E")).toHaveCount(0);
  await bob.reload();
  await expect(chatMessage(bob, "Hello Bob from E2E")).toBeVisible();
});
