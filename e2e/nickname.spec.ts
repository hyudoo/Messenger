import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";
import { conversationWith, pageAs, send, userIds } from "./fixtures";

// Nicknames: Carol names Dave "Captain" in their chat (the drawer). Her chat's title and inbox call
// him that, both see the event, and Dave's messages show under the nickname; clearing it brings
// the name back.
test("a nickname replaces the name in the chat and the inbox, and can be removed", async ({ browser }) => {
  const ids = userIds();
  const carol = await pageAs(browser, "carol");
  const dave = await pageAs(browser, "dave");
  const conversationId = await conversationWith(carol, ids.dave);

  await dave.goto(`/en/conversations/${conversationId}`);
  await send(dave, "hello from dave");
  await carol.goto(`/en/conversations/${conversationId}`);

  await carol.getByRole("button", { name: "Conversation details" }).click();
  await carol.getByRole("button", { name: `Set a nickname for ${E2E_USERS.dave.name}` }).click();
  await carol.getByLabel(`Nickname for ${E2E_USERS.dave.name}`).fill("Captain");
  await carol.getByRole("button", { name: "Save" }).click();
  await carol.keyboard.press("Escape");

  // the event on both sides (in the chat and as the inbox preview: .first()), the inbox item on Carol's
  await expect(carol.getByText(`You set the nickname for ${E2E_USERS.dave.name} to “Captain”`).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(dave.getByText(`${E2E_USERS.carol.name} set the nickname for you to “Captain”`).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(carol.getByRole("link", { name: /Captain/ }).first()).toBeVisible();

  // removing it: the name is back
  await carol.getByRole("button", { name: "Conversation details" }).click();
  await carol.getByRole("button", { name: `Set a nickname for ${E2E_USERS.dave.name}` }).click();
  await carol.getByLabel(`Nickname for ${E2E_USERS.dave.name}`).fill("");
  await carol.getByRole("button", { name: "Save" }).click();
  await carol.keyboard.press("Escape");
  await expect(carol.getByText(`You removed the nickname of ${E2E_USERS.dave.name}`).first()).toBeVisible({
    timeout: 10_000,
  });
  await expect(carol.getByRole("link", { name: /Captain/ })).toHaveCount(0);
});
