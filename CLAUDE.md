# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. Topic details live in `.claude/rules/*.md`. Each of them is loaded only while working on the files its `paths:` frontmatter lists, so read the one for your topic directly when you need it before touching those files (see "Topic rules" below).

## Commands

- `docker compose up -d redis`: this project's own Redis (`messenger_redis`, `127.0.0.1:${REDIS_PORT}`, password `REDIS_PASSWORD` from `.env`).
  - Needed before `npm run dev` whenever `REDIS_HOST` / `REDIS_URL` is set, since the server exits if Redis is unreachable at boot.
  - In compose, the `app` service reaches it as `redis:6379` (compose overrides `REDIS_HOST` / `REDIS_PORT` and clears `REDIS_URL`).
- `npm run dev`: runs the custom server (`tsx watch server.ts`), i.e. Next dev (Turbopack) + socket.io on http://localhost:3000. `next dev` alone has no realtime.
  - Code under `app/` hot-reloads through Next.
  - `tsx watch` restarts the whole process when a file it loaded itself changes: `server.ts`, `server/`, the `app/libs` files the socket server imports, `next.config.js`.
  - It ignores dot folders and `node_modules`. `.env` changes need a manual restart.
- `npm run build` / `npm start`: production build (Turbopack) / serve. `start` also goes through `server.ts`. Both share `.next/`, so run `npm run build` again after a dev session before `npm start`.
- `npm run lint`: ESLint 9 (`eslint .`, flat config spreading `eslint-config-next/core-web-vitals`, React Compiler hook rules included). It also covers `server.ts` and `server/`.
- `npm test`: Vitest. `npx vitest run tests/api/routes.test.ts -t "DELETE"` runs one file / matching tests.
  - Redis tests need `TEST_REDIS_URL` (see `.claude/rules/testing.md`).
  - Run from `E:\gitlab\Messenger` (uppercase drive), or every Vitest file fails.
- `npm run test:e2e`: Playwright E2E in Chromium (`e2e/`, see `.claude/rules/testing.md`). It starts its own app on port 3100 (`e2e/serve.ts`: in-memory MongoDB, seeded users, `.next-e2e/`), so it runs next to `npm run dev`. First run: `npx playwright install chromium`.
- `npx tsc --noEmit`: typecheck.
- `npx prisma db push`: sync `prisma/schema.prisma` to MongoDB, including its `@@index`es (no migrations). `npx prisma generate` regenerates the client (also on `postinstall`).
- Both `package-lock.json` and `yarn.lock` are committed (npm keeps both in sync).

## Environment

Copy `.env.example` to `.env`.

- **Required:**
  - `DATABASE_URL` (MongoDB), `NEXTAUTH_SECRET`;
  - AWS: `AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, optional `NEXT_PUBLIC_S3_PUBLIC_URL`;
  - GitHub and Google OAuth credentials.
- **Optional:**
  - Redis for several instances: `REDIS_URL`, or `REDIS_HOST` / `REDIS_PORT` / `REDIS_USERNAME` / `REDIS_PASSWORD` (or `REDIS_PASSWORD_FILE`, a Docker / Kubernetes secret) (`getRedisUrl()` in `app/libs/redis-url.ts`; `REDIS_URL` wins).
  - `TURN_URLS` / `TURN_SECRET` / `TURN_TTL_SECONDS`: TURN for calls.
  - `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM`: "forgot password" mails (see `.claude/rules/auth.md`); links use `NEXTAUTH_URL`.
  - `TRUST_PROXY=true`: behind a proxy that sets `X-Real-IP`.
  - `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` / `VAPID_SUBJECT`: Web Push. Generate with `npx web-push generate-vapid-keys`; read at run time; keep the pair stable.
- Production gets its `.env` from the CI variable `ENV_FILE`.

## Architecture

Next.js 16 App Router messenger (React 19), TypeScript (ES5 target: no `u` regex flag, iterate with `Array.from`), Tailwind 3, Prisma 6 + MongoDB, NextAuth v4 (JWT), socket.io (optional Redis adapter), WebRTC calls (1:1, groups as a P2P mesh), S3 uploads, Web Push, zustand, next-intl. Path alias `@/*` = repo root.

- `app/[locale]/`: every page. `app/api/**/route.ts`: mutations, called with `axios`.
- `app/actions/`: plain async server functions that call Prisma, not Server Actions. `getSession` / `getCurrentUser` are `cache()`d.
- `app/libs/`: shared logic.
- `server.ts` + `server/`: one process for Next and socket.io. Route handlers reach it through `globalThis.io` (`emitToUser` / `emitToConversation`), so no serverless.

### Rules that apply everywhere
- **i18n:** every visible string goes through `t()` and into both `i18n/messages/vi.json` and `en.json` (same keys and placeholders; a test and `tsc` enforce it). Navigate with `@/i18n/navigation`, never `next/link` / `next/navigation`.
- **Theme:** use the color tokens (`bg-background`, `text-foreground`, `bg-muted`, `text-muted-foreground`, `border-border`), not raw grays/white/black. The call screen is the exception.
- **Membership:** anything keyed by a conversation id goes through `getConversationForUser(id, userId)`, which returns null for "missing" and "not a member" alike.
- **Messages:** every message sent to the chat view uses `MESSAGE_INCLUDE` (`app/libs/message-include.ts`). A `messages:update` replaces the client's copy, so a message without `reactions` / `replyTo` would wipe them.
- **Users:** `app/libs/prismadb.ts` globally omits `hashedPassword` and the user's private `mutedConversationIds` / `pinnedConversationIds` / `blockedUserIds` / `friendIds` / `hideActivity` / `hideReadReceipts`, so user rows are safe to send to clients (read those with an explicit `select`). It also omits the messages' server-side `hiddenForIds` / `privateSeenIds` / `searchText`. Type them on the client as `SafeUser`, not Prisma's `User`.
- **After a DB write:** route handlers emit over socket.io. Socket data is plain JSON, so dates arrive as ISO strings. Server components may pass `Date`s.
- **Errors:** log with `logError(tag, error, context?)` (`app/libs/log.ts`), never with secrets or message text in the context.
- **Rate limiting:** key on `x-client-ip` (set by `server.ts`), never on `X-Forwarded-For`.
- **External hosts:** a new image / upload / CDN host goes into `next.config.js`: `images.remotePatterns` and the CSP lists.
- **Next 15/16:**
  - `params` is a `Promise` (`const { id } = await params`).
  - Route files export only handlers / config, so shared values live in `app/libs/`.
  - Middleware is `proxy.ts`.
- **React 19 / Compiler:** `useRef` needs an initial value; use `useWatch({ control, name })`, not `watch()`. No `setState` in effects: use `useSyncExternalStore` for browser-only values.

### Topic rules (`.claude/rules/`)
| File | Topic |
| --- | --- |
| `chat.md` | conversation list, unread, optimistic outbox, pagination, reconnect resync, typing, reply / edit / recall, emoji, reactions, groups, deleting |
| `realtime.md` | socket server, Redis adapter, rooms, events, presence, session expiry, shutdown |
| `calls.md` | WebRTC calls: audio / video, group mesh, ringing, joining late, decline / cancel, call log, ICE / TURN |
| `notifications.md` | desktop notifications, Web Push for messages and calls, `sw.js` |
| `uploads.md` | S3 presigned uploads, pending tag, ownership, cleanup, image hosts |
| `auth.md` | NextAuth, `proxy.ts`, passwords, rate limits |
| `i18n-theme.md` | next-intl details, navigation, dates, theme provider and tokens |
| `ci-deploy.md` | GitLab CI, Docker image, health check, rollback, security headers |
| `testing.md` | test layout, mocks, Redis tests, Vitest quirks |
