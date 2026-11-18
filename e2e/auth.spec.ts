import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";

test.describe("signing in", () => {
  test("refuses a wrong password and keeps the visitor on the login page", async ({ page }) => {
    await page.goto("/en", { waitUntil: "networkidle" });
    await page.getByLabel("Email").fill(E2E_USERS.alice.email);
    await page.getByLabel("Password").fill("not-the-password");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("Sign-in failed!")).toBeVisible();
    await expect(page).toHaveURL(/\/en$/);
  });

  test("sends a signed-out visitor from a protected page to the login page", async ({ page }) => {
    await page.goto("/en/conversations");
    await expect(page).toHaveURL(/\/en$/);
  });
});
