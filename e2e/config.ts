import path from "path";

// Shared by playwright.config.ts, the server launcher (e2e/serve.ts) and the tests.
export const E2E_PORT = Number(process.env.E2E_PORT || 3100);

export const E2E_PASSWORD = "E2e-Passw0rd!";

// seeded fresh on every run (in-memory database)
export const E2E_USERS = {
  alice: { name: "Alice E2E", email: "alice@e2e.test" },
  bob: { name: "Bob E2E", email: "bob@e2e.test" },
  carol: { name: "Carol E2E", email: "carol@e2e.test" },
  dave: { name: "Dave E2E", email: "dave@e2e.test" },
} as const;

export type E2EUser = keyof typeof E2E_USERS;

// written by e2e/serve.ts, read by the tests
const STATE_DIR = path.join(__dirname, ".state");
export const USERS_FILE = path.join(STATE_DIR, "users.json");
// the mails the app would have sent (app/libs/account-mail.ts: MAIL_OUTBOX_FILE, set by serve.ts)
export const MAIL_OUTBOX = path.join(STATE_DIR, "mail.jsonl");
export const storageStateOf = (user: E2EUser) => path.join(STATE_DIR, `${user}.json`);
