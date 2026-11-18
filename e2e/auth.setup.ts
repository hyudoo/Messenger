import { expect, test as setup } from "@playwright/test";

import { E2E_PASSWORD, E2E_USERS, E2EUser, storageStateOf } from "./config";

// Signs every seeded user in through the login form once and saves the session for the tests.
for (const user of Object.keys(E2E_USERS) as E2EUser[]) {
  setup(`sign in as ${user}`, async ({ page }) => {
    // the first visit compiles the page: wait until it is hydrated, or the click would submit
    // the form natively before the handlers exist
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(E2E_USERS[user].email);
    await page.getByLabel("Password").fill(E2E_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    // the inbox compiles on its first visit too
    await expect(page).toHaveURL(/\/en\/conversations/, { timeout: 60_000 });
    await page.context().storageState({ path: storageStateOf(user) });
  });
}
