import { expect, test, type Page } from "@playwright/test";

import { E2E_USERS } from "./config";
import { conversationWith, pageAs, userIds } from "./fixtures";

// Turning the camera / mic off and on during a call (replaceTrack on the video sender, no new
// offer / answer, call:media for the others' UI), and an audio call switching to video. What
// Vitest can't cover: real WebRTC with Chromium's fake camera and mic (playwright.config.ts).

// the remote picture (the self view is the muted <video>): whether frames are arriving
const remoteVideoPlays = (page: Page) =>
  page.evaluate(async () => {
    const video = Array.from(document.querySelectorAll("video")).find((item) => !item.muted);
    if (!video || video.videoWidth === 0) {
      return false;
    }
    const before = video.currentTime;
    await new Promise((resolve) => setTimeout(resolve, 500));
    return video.currentTime > before;
  });

// Bob calls Dave (kind: the header button), Dave accepts, both see the timer
const startCall = async (browser: Parameters<typeof pageAs>[0], kind: "Video call" | "Audio call") => {
  const ids = userIds();
  const bob = await pageAs(browser, "bob");
  const dave = await pageAs(browser, "dave");
  const conversationId = await conversationWith(bob, ids.dave);

  await dave.goto("/en/conversations");
  await bob.goto(`/en/conversations/${conversationId}`);
  await bob.getByRole("button", { name: kind }).click();
  await expect(bob).toHaveURL(new RegExp(`/en/room/${conversationId}$`));
  await dave.getByRole("button", { name: "Accept" }).click();
  await expect(dave).toHaveURL(new RegExp(`/en/room/${conversationId}$`));
  // the timer shows in the header and, in an audio call, on the cover too
  await expect(bob.getByText(/^\d+:\d{2}$/).first()).toBeVisible({ timeout: 30_000 });
  await expect(dave.getByText(/^\d+:\d{2}$/).first()).toBeVisible({ timeout: 30_000 });
  return { bob, dave };
};

const hangUp = async (bob: Page, dave: Page) => {
  await bob.getByRole("button", { name: "Leave call" }).click();
  await expect(dave).not.toHaveURL(/\/room\//, { timeout: 15_000 });
};

test("turning the camera and mic off and on shows on the other side", async ({ browser }) => {
  const { bob, dave } = await startCall(browser, "Video call");
  const cameraOff = dave.getByText(`${E2E_USERS.bob.name} turned off the camera`);

  await expect.poll(() => remoteVideoPlays(dave), { timeout: 15_000 }).toBe(true);
  await expect(cameraOff).toBeHidden();

  // camera off: Dave sees Bob's avatar and "turned off the camera"
  await bob.getByRole("button", { name: "Turn camera off" }).click();
  await expect(bob.getByRole("button", { name: "Turn camera on" })).toBeVisible();
  await expect(cameraOff).toBeVisible({ timeout: 10_000 });

  // on again: a new camera track on the same sender, frames reach Dave
  await bob.getByRole("button", { name: "Turn camera on" }).click();
  await expect(cameraOff).toBeHidden({ timeout: 10_000 });
  await expect.poll(() => remoteVideoPlays(dave), { timeout: 15_000 }).toBe(true);

  // mic: Dave's header shows the muted icon while Bob is muted
  const muted = dave.getByLabel("Muted");
  await bob.getByRole("button", { name: "Mute", exact: true }).click();
  await expect(muted).toBeVisible({ timeout: 10_000 });
  await bob.getByRole("button", { name: "Unmute" }).click();
  await expect(muted).toBeHidden({ timeout: 10_000 });

  await hangUp(bob, dave);
});

test("an audio call switches to video", async ({ browser }) => {
  const { bob, dave } = await startCall(browser, "Audio call");

  // nothing to see yet: Dave's cover says it is an audio call
  await expect(dave.getByText("Audio call").first()).toBeVisible();
  expect(await remoteVideoPlays(dave)).toBe(false);

  await bob.getByRole("button", { name: "Turn camera on" }).click();
  await expect(bob.getByRole("button", { name: "Turn camera off" })).toBeVisible();
  // the camera goes out on the video transceiver negotiated at the start
  await expect.poll(() => remoteVideoPlays(dave), { timeout: 15_000 }).toBe(true);

  await hangUp(bob, dave);
});
