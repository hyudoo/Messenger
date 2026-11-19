import { APIRequestContext, Browser, Page, expect, test } from "@playwright/test";

import { mailedLink, pageAs, userIds } from "./fixtures";

// A user of its own (deleting a seeded one would break the other specs), with a 1:1 chat with Bob,
// a group with Bob and Carol where Bob replies to and reacts to their message, and a friend
// request to Carol. Real MongoDB: the raw $pulls and Prisma's emulated cascades only run here.
const PASSWORD = "De1ete-Passw0rd!";

const registerVerified = async (request: APIRequestContext, email: string) => {
  const registered = await request.post("/api/register", {
    data: { email, name: "Leaving E2E", password: PASSWORD, locale: "en" },
  });
  expect(registered.ok()).toBeTruthy();
  const token = new URL(await mailedLink(email, "/verify-email"), "http://x").searchParams.get("token");
  expect((await request.post("/api/email/verify", { data: { token } })).ok()).toBeTruthy();
};

const signIn = async (browser: Browser, email: string, password: string) => {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/en", { waitUntil: "networkidle" });
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  return page;
};

const post = async (page: Page, url: string, data: unknown) => {
  const response = await page.request.post(url, { data });
  expect(response.ok(), `${url}: ${response.status()}`).toBeTruthy();
  return response.json();
};

test("deleting an account removes its chats, messages and requests, and signs it out", async ({
  browser,
  request,
}) => {
  const email = `leaving-${Date.now()}@e2e.test`;
  await registerVerified(request, email);
  const leaving = await signIn(browser, email, PASSWORD);
  await expect(leaving).toHaveURL(/\/en\/conversations/, { timeout: 60_000 });
  const ids = userIds();
  const bob = await pageAs(browser, "bob");

  // a 1:1 chat with Bob
  const direct = (await post(leaving, "/api/conversations", { userId: ids.bob })).id as string;
  await post(leaving, "/api/messages", { conversationId: direct, message: "Just us two" });
  // a group: Bob replies to their message and reacts to it
  const group = (
    await post(leaving, "/api/conversations", {
      isGroup: true,
      name: "Leaving group",
      members: [{ value: ids.bob }, { value: ids.carol }],
    })
  ).id as string;
  const theirs = (await post(leaving, "/api/messages", { conversationId: group, message: "Bye all" })).id;
  const reply = (
    await post(bob, "/api/messages", { conversationId: group, message: "Reply to the leaver", replyToId: theirs })
  ).id;
  await post(bob, `/api/messages/${theirs}/reactions`, { emoji: "👍" });
  // a friend request to Carol
  await post(leaving, "/api/friends/requests", { userId: ids.carol });

  // delete from Settings: a wrong password first
  await leaving.getByRole("button", { name: "Settings" }).first().dispatchEvent("click");
  await leaving.getByRole("button", { name: "Delete account…" }).click();
  const field = leaving.getByLabel("Enter your password to confirm");
  await field.fill("Wrong-Passw0rd!");
  await leaving.getByRole("button", { name: "Delete permanently" }).click();
  await expect(leaving.getByText("Wrong password.")).toBeVisible();
  await field.fill(PASSWORD);
  await leaving.getByRole("button", { name: "Delete permanently" }).click();

  // signed out, on the home page with a notice; signing in again fails
  await expect(leaving).toHaveURL(/\/en\?deleted=1$/, { timeout: 30_000 });
  await expect(leaving.getByText("Your account has been deleted.")).toBeVisible();
  expect((await leaving.request.get("/api/conversations")).status()).toBe(401);
  const again = await signIn(browser, email, PASSWORD);
  await expect(again).toHaveURL(/\/en(\?.*)?$/);
  await expect(again.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  // Bob: the 1:1 chat is gone, the group stays without their message, his reply lost its quote
  const bobInbox = (await (await bob.request.get("/api/conversations")).json()) as { id: string }[];
  expect(bobInbox.map((item) => item.id)).not.toContain(direct);
  expect((await bob.request.get(`/api/conversations/${direct}/messages`)).status()).toBe(404);
  const page = (await (await bob.request.get(`/api/conversations/${group}/messages`)).json()) as {
    messages: { id: string; replyTo: unknown; senderId: string }[];
  };
  expect(page.messages.map((message) => message.id)).not.toContain(theirs);
  expect(page.messages.some((message) => message.senderId !== ids.bob && message.senderId !== ids.carol)).toBe(false);
  expect(page.messages.find((message) => message.id === reply)?.replyTo).toBeNull();
  // the group passed to another member
  await bob.goto(`/en/conversations/${group}`);
  await expect(bob.getByText("Reply to the leaver").first()).toBeVisible();

  // Carol: no request waiting from them
  const carol = await pageAs(browser, "carol");
  const requests = await (await carol.request.get("/api/friends/requests")).json();
  expect(JSON.stringify(requests)).not.toContain("Leaving E2E");
});
