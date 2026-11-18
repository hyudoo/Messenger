import { expect, test } from "@playwright/test";

import { conversationWith, pageAs, userIds } from "./fixtures";

// Chromium's fake camera and microphone (playwright.config.ts) stand in for real devices.
test("a video call connects both sides and ends for both", async ({ browser }) => {
  const ids = userIds();
  const alice = await pageAs(browser, "alice");
  const carol = await pageAs(browser, "carol");
  const conversationId = await conversationWith(alice, ids.carol);

  await carol.goto("/en/conversations");
  await alice.goto(`/en/conversations/${conversationId}`);
  await alice.getByRole("button", { name: "Video call" }).click();
  await expect(alice).toHaveURL(new RegExp(`/en/room/${conversationId}$`));
  await expect(alice.getByText(/Waiting for/).first()).toBeVisible();

  // the call rings on Carol's inbox; she accepts
  await carol.getByRole("button", { name: "Accept" }).click();
  await expect(carol).toHaveURL(new RegExp(`/en/room/${conversationId}$`));

  // both show the running timer once media flows (the status shows in the header and on the cover)
  await expect(alice.getByText(/^\d+:\d{2}$/)).toBeVisible({ timeout: 30_000 });
  await expect(carol.getByText(/^\d+:\d{2}$/)).toBeVisible({ timeout: 30_000 });

  // Alice hangs up: Carol's side leaves the room too
  await alice.getByRole("button", { name: "Leave call" }).click();
  await expect(carol).not.toHaveURL(/\/room\//, { timeout: 15_000 });
});
