import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";
import { chatMessage, conversationWith, pageAs, send, userIds } from "./fixtures";

// The inbox search also finds messages in every conversation (GET /api/search, folded: no case,
// no diacritics), and a result opens its chat at that message.
test("finds a message from the inbox and opens the chat at it", async ({ browser }) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const bob = await pageAs(browser, "bob");
  const conversationId = await conversationWith(alice, ids.bob);
  const text = `Hẹn gặp ở quán Cà Phê ${Date.now()}`;

  await alice.goto(`/en/conversations/${conversationId}`);
  await send(alice, text);
  await expect(chatMessage(alice, text)).toBeVisible();
  await send(alice, "something after it");

  await bob.goto("/en/conversations");
  // without diacritics and in another case than the message
  await bob.getByPlaceholder("Search chats and messages").fill("QUAN CA PHE");
  const result = bob.getByRole("link", { name: new RegExp(E2E_USERS.alice.name) }).filter({
    hasText: /Cà Phê/,
  });
  await expect(bob.getByText("Messages", { exact: true })).toBeVisible();
  await expect(result.first()).toBeVisible({ timeout: 10_000 });
  await result.first().click();

  // the chat opens at the message (flashed), and the jump parameter is gone from the address
  await expect(bob).toHaveURL(new RegExp(`/en/conversations/${conversationId}$`));
  await expect(chatMessage(bob, text)).toHaveClass(/message-flash/);
});
