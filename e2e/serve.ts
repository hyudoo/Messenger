// The app for the E2E tests (playwright.config.ts starts this as its webServer):
// an in-memory MongoDB replica set (Prisma needs one; no Docker), the schema pushed to it,
// a few seeded users, then server.ts itself in this process on E2E_PORT.
//
// Everything that would reach real services is switched off here (Redis, Web Push); the values
// set below win over .env, which Next only reads for variables not set yet.
import { execSync } from "child_process";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import path from "path";
import bcrypt from "bcrypt";
import { PrismaClient } from "@prisma/client";
import { MongoMemoryReplSet } from "mongodb-memory-server";

import { E2E_PASSWORD, E2E_PORT, E2E_USERS, USERS_FILE } from "./config";

// The dev server's build folder for these runs. Emptied on every start: a cache left from an
// older version of the code made the first page visit reload over and over (hundreds of loads of
// /en, next to a hydration warning about a streamed <meta charset>), so the sign-ins timed out;
// a fresh compile takes a few seconds more and never did.
const DIST_DIR = ".next-e2e";

const main = async () => {
  rmSync(path.join(process.cwd(), DIST_DIR), { recursive: true, force: true });
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: "wiredTiger" },
  });
  const databaseUrl = replSet.getUri("messenger_e2e");

  Object.assign(process.env, {
    // the dev server (compiles on demand, no build needed); .env may say production
    NODE_ENV: "development",
    DATABASE_URL: databaseUrl,
    PORT: String(E2E_PORT),
    HOSTNAME: "localhost",
    NEXTAUTH_URL: `http://localhost:${E2E_PORT}`,
    NEXTAUTH_SECRET: "e2e-only-nextauth-secret",
    // in memory: no Redis adapter, rate limits counted here
    REDIS_URL: "",
    REDIS_HOST: "",
    // no Web Push
    VAPID_PUBLIC_KEY: "",
    VAPID_PRIVATE_KEY: "",
    // its own build folder, so it can run next to `npm run dev` (next.config.js)
    NEXT_DIST_DIR: DIST_DIR,
  });

  execSync("npx prisma db push --skip-generate", {
    stdio: "inherit",
    env: process.env,
  });

  const prisma = new PrismaClient({ datasourceUrl: databaseUrl });
  const hashedPassword = await bcrypt.hash(E2E_PASSWORD, 10);
  const ids: Record<string, string> = {};
  for (const [key, user] of Object.entries(E2E_USERS)) {
    const created = await prisma.user.create({
      data: { name: user.name, email: user.email, hashedPassword },
      select: { id: true },
    });
    ids[key] = created.id;
  }
  await prisma.$disconnect();
  // the tests read the seeded ids (e.g. to create a group through the API)
  mkdirSync(path.dirname(USERS_FILE), { recursive: true });
  writeFileSync(USERS_FILE, JSON.stringify(ids, null, 2));

  // mongod is a child process: stop it with the app
  const stop = () => {
    void replSet.stop().catch(() => {});
  };
  process.once("exit", stop);

  await import("../server");
};

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
