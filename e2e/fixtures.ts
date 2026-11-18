import { readFileSync } from "fs";
import { Browser, Page, expect } from "@playwright/test";

import { E2EUser, USERS_FILE, storageStateOf } from "./config";

// The seeded users' ids (e2e/serve.ts).
export const userIds = (): Record<E2EUser, string> => JSON.parse(readFileSync(USERS_FILE, "utf8"));

// A page signed in as the user (the session saved by auth.setup.ts), in its own context, so two
// users can talk to each other in one test.
export const pageAs = async (browser: Browser, user: E2EUser): Promise<Page> => {
  const context = await browser.newContext({ storageState: storageStateOf(user) });
  return context.newPage();
};

// The 1:1 conversation with another user (created, or the existing one), through the API.
export const conversationWith = async (page: Page, userId: string) => {
  const response = await page.request.post("/api/conversations", { data: { userId } });
  expect(response.ok()).toBeTruthy();
  return ((await response.json()) as { id: string }).id;
};

// Sends a message from the open chat's composer.
export const send = async (page: Page, text: string) => {
  const input = page.getByPlaceholder("Write a message");
  await input.fill(text);
  await input.press("Enter");
};

// A message in the open chat (rows are id="message-<id>"), not its preview in the inbox list.
export const chatMessage = (page: Page, text: string) =>
  page.locator('[id^="message-"]').filter({ hasText: text });
