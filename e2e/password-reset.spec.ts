import { expect, test } from "@playwright/test";

import { E2E_USERS } from "./config";

// "Forgot password" from the login page. The E2E server has no SMTP (e2e/serve.ts), so the mail
// itself isn't checked here (tests/api/password-reset.test.ts covers the link and the token).
test("asks for a reset link, and refuses a made-up one", async ({ page }) => {
  await page.goto("/en", { waitUntil: "networkidle" });
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/en\/forgot-password$/);

  await page.getByLabel("Email").fill(E2E_USERS.alice.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page.getByRole("status")).toContainText(E2E_USERS.alice.email);

  await page.goto(`/en/reset-password?token=${"A".repeat(43)}`, { waitUntil: "networkidle" });
  await page.getByLabel("New password", { exact: true }).fill("Another-passw0rd!");
  await page.getByLabel("Confirm new password").fill("Another-passw0rd!");
  await page.getByRole("button", { name: "Save new password" }).click();
  // (Next's own route announcer is another, empty, role="alert")
  await expect(page.getByText("This link is invalid or has expired. Ask for a new one.")).toBeVisible();
});
