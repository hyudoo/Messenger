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

  // what Google's OAuth branding review looks for: the home page says what the app is and links
  // the policies
  test("the home page describes the app and links its policies", async ({ page }) => {
    await page.goto("/en");
    await expect(page.getByRole("heading", { level: 1, name: "Messenger" })).toBeVisible();
    await expect(page.getByText(/web messenger for chatting/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Privacy Policy" })).toHaveAttribute("href", "/en/privacy");
    await expect(page.getByRole("link", { name: "Terms of Service" })).toHaveAttribute("href", "/en/terms");
  });

  test("sends a signed-out visitor from a protected page to the login page", async ({ page }) => {
    await page.goto("/en/conversations");
    await expect(page).toHaveURL(/\/en$/);
  });
});
