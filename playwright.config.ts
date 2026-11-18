import { defineConfig, devices } from "@playwright/test";

import { E2E_PORT } from "./e2e/config";

// End-to-end tests in Chromium against the real app: e2e/serve.ts starts it on E2E_PORT with an
// in-memory MongoDB and seeded users. Run with `npm run test:e2e` (the first run also needs
// `npx playwright install chromium`; mongodb-memory-server downloads a mongod binary once).
export default defineConfig({
  testDir: "./e2e",
  // one app and one database shared by the tests: run them one after another
  workers: 1,
  fullyParallel: false,
  // the dev server compiles each page on its first visit
  timeout: 120_000,
  expect: { timeout: 20_000 },
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    locale: "en-US",
    trace: "retain-on-failure",
    // calls: a fake camera / microphone, granted without a prompt
    permissions: ["camera", "microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        // host ICE candidates as plain IPs, not mDNS names (*.local), which don't resolve
        // between two browser contexts on every machine: the call would stay "Connecting…"
        "--disable-features=WebRtcHideLocalIpsWithMdns",
      ],
    },
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
      testIgnore: /auth\.setup\.ts/,
    },
  ],
  webServer: {
    command: "npx tsx e2e/serve.ts",
    url: `http://localhost:${E2E_PORT}/api/health`,
    // first run: the mongod download and the first compile
    timeout: 300_000,
    reuseExistingServer: false,
    stdout: "pipe",
  },
});
