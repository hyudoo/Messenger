import { expect, test } from "@playwright/test";

import { mailedLink } from "./fixtures";

const PASSWORD = "V3rify-Passw0rd!";

// Signing up with a password: the account waits for its email to be verified (the mailed link,
// read from the app's outbox), can't sign in before, and a new mail replaces the first link.
test("a new account verifies its email before it can sign in", async ({ page }) => {
  const email = `verify-${Date.now()}@e2e.test`;
  await page.goto("/en", { waitUntil: "networkidle" });
  await page.getByText("Create an account").click();
  await page.getByLabel("Full name").fill("Verify E2E");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
  await page.getByLabel("Confirm password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign up", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
  await expect(page.getByText(`We sent a verification link to ${email}`)).toBeVisible();
  const first = await mailedLink(email, "/verify-email");

  // signing in before verifying: held back, with a way to get a new mail
  await page.getByRole("button", { name: "Back to sign in" }).click();
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Email not verified yet" })).toBeVisible();
  await page.getByRole("button", { name: "Resend the verification email" }).click();
  await expect(page.getByText("Verification email sent again!")).toBeVisible();
  await expect.poll(() => mailedLink(email, "/verify-email")).not.toBe(first);
  const second = await mailedLink(email, "/verify-email");

  // the first link stopped working; the new one verifies
  await page.goto(first);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByText("This link is invalid or has expired.", { exact: false })).toBeVisible();

  await page.goto(second);
  await page.getByRole("button", { name: "Verify email" }).click();
  await expect(page.getByText("Your email is verified.", { exact: false })).toBeVisible();

  await page.goto("/en", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/conversations/, { timeout: 60_000 });
});
