import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";
import { pageAs } from "./fixtures";

// Friends on the contacts page: Carol finds Dave by name and asks; Dave's page shows the request
// at once (contacts:update), he accepts; both see each other under Friends; Carol unfriends him.
test("a friend request is sent, accepted, and the friendship ended", async ({ browser }) => {
  const carol = await pageAs(browser, "carol");
  const dave = await pageAs(browser, "dave");
  await carol.goto("/en/users");
  await dave.goto("/en/users");

  const friendsOfCarol = carol.getByRole("button", { name: new RegExp(E2E_USERS.dave.name) });
  const friendsOfDave = dave.getByRole("button", { name: new RegExp(E2E_USERS.carol.name) });
  await expect(friendsOfCarol).toHaveCount(0);

  // Carol asks (the search result's "Add friend" turns into "Requested")
  await carol.getByPlaceholder(/find people/i).fill(E2E_USERS.dave.name);
  await carol.getByRole("button", { name: "Add friend" }).click();
  await expect(carol.getByText("Requested")).toBeVisible();
  await carol.getByPlaceholder(/find people/i).fill("");
  await expect(carol.getByText("Sent requests")).toBeVisible();

  // Dave's page shows it without a reload; he accepts
  await expect(dave.getByText("1 friend request")).toBeVisible({ timeout: 10_000 });
  await dave.getByRole("button", { name: "Accept" }).click();

  // friends on both sides (Carol's page reloads on contacts:update)
  await expect(friendsOfDave.first()).toBeVisible({ timeout: 10_000 });
  await expect(friendsOfCarol.first()).toBeVisible({ timeout: 10_000 });
  await expect(carol.getByText("Sent requests")).toBeHidden();

  // Carol unfriends Dave (a confirming second click): gone from both lists
  const unfriend = carol.getByRole("button", { name: "Unfriend" });
  await friendsOfCarol.first().hover();
  await unfriend.click();
  await carol.getByRole("button", { name: "Click again to unfriend" }).click();
  await expect(friendsOfCarol).toHaveCount(0, { timeout: 10_000 });
  await expect(friendsOfDave).toHaveCount(0, { timeout: 10_000 });
});
