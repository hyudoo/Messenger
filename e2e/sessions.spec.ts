import { Browser, Page, expect, test } from "@playwright/test";

// A user of its own: changing the password ends every session of the user, which would sign the
// seeded users' saved sessions out for the other specs.
const EMAIL = `sessions-${Date.now()}@e2e.test`;
const OLD_PASSWORD = "0ld-Passw0rd!";
const NEW_PASSWORD = "N3w-Passw0rd!";

// the sidebar's Settings avatar sits under the Next dev tools button (bottom left in dev mode)
const openSettings = (page: Page) =>
  page.getByRole("button", { name: "Settings" }).first().dispatchEvent("click");

const signIn = async (browser: Browser, email: string, password: string) => {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/en", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/en\/conversations/, { timeout: 60_000 });
  return page;
};

test("changing the password signs out the other devices and keeps this one signed in", async ({
  browser,
  request,
}) => {
  const registered = await request.post("/api/register", {
    data: { email: EMAIL, name: "Sessions E2E", password: OLD_PASSWORD },
  });
  expect(registered.ok()).toBeTruthy();

  const here = await signIn(browser, EMAIL, OLD_PASSWORD);
  const elsewhere = await signIn(browser, EMAIL, OLD_PASSWORD);

  await openSettings(here);
  await here.getByLabel("Current password", { exact: true }).fill("Wrong-Passw0rd!");
  await here.getByLabel("New password", { exact: true }).fill(NEW_PASSWORD);
  await here.getByLabel("Repeat the new password", { exact: true }).fill(NEW_PASSWORD);
  await here.getByRole("button", { name: "Change password" }).click();
  await expect(here.getByText("The current password is wrong!")).toBeVisible();

  await here.getByLabel("Current password", { exact: true }).fill(OLD_PASSWORD);
  await here.getByRole("button", { name: "Change password" }).click();
  await expect(here.getByText("Password changed.", { exact: false })).toBeVisible();

  // the other device's open tab loses its socket and lands on the login page
  await expect(elsewhere).toHaveURL(/\/en$/, { timeout: 20_000 });
  await elsewhere.goto("/en/conversations");
  await expect(elsewhere).toHaveURL(/\/en$/);

  // this device got a new cookie and stays signed in
  await here.goto("/en/conversations");
  await expect(here).toHaveURL(/\/en\/conversations/);
  expect((await here.request.get("/api/conversations")).ok()).toBeTruthy();

  // only the new password works now
  await (await signIn(browser, EMAIL, NEW_PASSWORD)).context().close();
});

test("signing out other devices keeps only this one", async ({ browser, request }) => {
  const email = `others-${Date.now()}@e2e.test`;
  expect(
    (await request.post("/api/register", { data: { email, name: "Others E2E", password: OLD_PASSWORD } })).ok()
  ).toBeTruthy();
  const here = await signIn(browser, email, OLD_PASSWORD);
  const elsewhere = await signIn(browser, email, OLD_PASSWORD);

  await openSettings(here);
  await here.getByRole("button", { name: "Sign out other devices" }).click();
  await here.getByRole("button", { name: "Confirm sign out" }).click();
  await expect(here.getByText("Your other devices were signed out.")).toBeVisible();

  await expect(elsewhere).toHaveURL(/\/en$/, { timeout: 20_000 });
  await here.goto("/en/conversations");
  await expect(here).toHaveURL(/\/en\/conversations/);
});
