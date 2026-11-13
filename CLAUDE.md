# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

- `npm run dev` — runs the custom server (`tsx server.ts`): Next dev + socket.io on http://localhost:3000. `next dev` alone has no realtime. Changes under `server/` need a restart (no watch).
- `npm run build` / `npm start` — production build / serve (`start` also goes through `server.ts`)
- `npm run lint` — `next lint` (legacy `.eslintrc.json`, extends `next/core-web-vitals`; `next lint` is deprecated in Next 15 and gone in 16)
- `npx tsc --noEmit` — typecheck
- `npx prisma db push` — sync `prisma/schema.prisma` to MongoDB, including its `@@index`es (no migrations; MongoDB provider)
- `npx prisma generate` — regenerate the client (also runs on `postinstall`)

There is no test suite. Both `package-lock.json` and `yarn.lock` are committed (npm keeps both in sync).

`npm run dev` and `npm start` share `.next/`, so run `npm run build` again after a dev session before `npm start`.

Copy `.env.example` to `.env`: `DATABASE_URL` (MongoDB), `NEXTAUTH_SECRET`, AWS (`AWS_REGION`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `AWS_S3_BUCKET`, optional `NEXT_PUBLIC_S3_PUBLIC_URL`), GitHub and Google OAuth credentials.

## Architecture

Next.js 15 App Router messenger app (React 19), TypeScript, Tailwind 3, Prisma 6 + MongoDB, NextAuth v4, socket.io for realtime, WebRTC for 1:1 video calls, S3 for uploads. UI strings are partly in Vietnamese. Path alias `@/*` maps to the repo root.

Next 15 rules that bite here: `params` in pages and route handlers is a `Promise` (`const { id } = await params`); route files may only export handlers/config, so shared values such as `authOptions` live in `app/libs/`; `useRef` needs an initial value under React 19 types.

**Data flow**
- Server components fetch data via functions in `app/actions/` (e.g. `getCurrentUser`, `getConversations`, `getMessages`) that call Prisma directly — plain async server functions, not Server Actions. `getSession` / `getCurrentUser` are wrapped in React `cache()`, so call them freely within a request.
- **Membership rule:** anything keyed by a conversation id (pages, `/api/messages`, `seen`, DELETE) must go through `getConversationForUser(id, userId)`, which returns null for "missing" and "not a member" alike. The socket server does its own check for `conversation:join` / `call:join`.
- **Passwords:** `app/libs/prismadb.ts` sets a global `omit: { user: { hashedPassword: true } }` (Prisma 6), so user rows are safe to pass to client components and sockets. Only the credentials `authorize` in `app/libs/auth.ts` opts back in. Client code types users as `SafeUser` (`app/types`), not Prisma's `User`. Password rules live in `app/libs/password.ts` and run on both the form and `/api/register`.
- Conversation lists load only the last message (`take: 1`); keep it that way when changing `getConversations`.
- Mutations go through Route Handlers in `app/api/**/route.ts`, called from client components with `axios`. After writing to the DB, each handler emits over socket.io via `emitToUser` / `emitToConversation` (`app/libs/socket-server.ts`).
- Server components pass Prisma objects (with `Date` fields) straight to client components; React 19's RSC serialization handles `Date`. Data arriving over socket.io is plain JSON, so dates there are ISO strings.
- `app/libs/prismadb.ts` holds a global Prisma singleton (shared by Next and the socket server).

**Auth**
- `authOptions` lives in `app/libs/auth.ts` (GitHub, Google, Credentials with bcrypt; JWT sessions; Prisma adapter); `app/api/auth/[...nextauth]/route.ts` only wraps it. `bcrypt` is listed in `serverExternalPackages`.
- `middleware.ts` protects `/conversations`, `/users`, `/room`; unauthenticated users go to `/` (the `(site)` route group with `AuthForm`).
- Socket connections are authenticated in `server/socket.ts` by decoding the NextAuth session cookie with `getToken` (`token.email`, `token.sub` = user id).

**Realtime (socket.io)**
- `server.ts` creates one HTTP server for Next and socket.io; `server/socket.ts` sets up the io server and stores it on `globalThis.io`, which is how route handlers reach it. This only works because everything runs in one process — no serverless/Vercel, and no multi-instance without a socket.io adapter (e.g. Redis).
- Client: one shared socket from `getSocket()` (`app/libs/socket-client.ts`). It is connected by `useActiveChannel` (mounted via `ActiveStatus` in the root layout) once the session is authenticated.
- Rooms (`app/libs/socket-rooms.ts`): `user:<email>` (joined automatically on connect), `conversation:<id>` (client calls `subscribeConversation`, server checks membership), `call:<roomId>`.
- Events — conversation room: `messages:new`, `messages:update` (bound in `conversations/[conversationId]/components/Body.tsx`). User room: `conversation:new`, `conversation:update`, `conversation:remove`, `recive-call` (bound in `conversations/components/ConversationList.tsx`). A `conversation:update` that carries `lastMessageAt` (new message) moves that conversation to the top; one without it (seen) updates in place. Presence: `presence:list` / `presence:online` / `presence:offline` carry emails into the zustand store `useActiveList`; components read it through `useIsActive(email)` so only the affected avatar re-renders.

**Video calls**
- Starting a call (`conversations/[conversationId]/components/Header.tsx`) posts a message with `isCall: true` to `/api/messages`, which also emits `recive-call` to the other participants. Accepting navigates to `/room/<conversationId>` (room id == conversation id).
- `app/room/[roomId]/components/Room.tsx` does peer-to-peer WebRTC. `call:join` (with ack) admits at most 2 conversation members; the first is the host. Signalling events `call:ready`, `call:offer`, `call:answer`, `call:ice-candidate` are relayed as-is to the other peer; `call:leave` or a disconnect sends `call:peer-left`, which ends the call on the other side. Only STUN servers are configured (no TURN).

**Uploads (S3)**
- `ImageUploadButton` → `uploadImage` (`app/libs/upload.ts`) asks `POST /api/uploads` for a presigned PUT URL (`app/libs/s3.ts`), uploads straight from the browser, and stores the returned public URL (message `image` or user `image`).
- Content type and length are signed into the URL; allowed types and the 10MB limit live in `app/libs/upload.ts`. Keys are `uploads/<userId>/<uuid>.<ext>`.
- The bucket must allow public `GetObject` on `uploads/*` (or sit behind CloudFront via `NEXT_PUBLIC_S3_PUBLIC_URL`) and have CORS allowing `PUT` from the app origin.
- `/api/messages` and `/api/settings` only accept image URLs from this bucket (`isUploadedFileUrl` in `app/libs/s3.ts`); settings also keeps the user's existing image (e.g. an OAuth avatar).
- `images.remotePatterns` in `next.config.js` allows only this app's upload host (`NEXT_PUBLIC_S3_PUBLIC_URL`, else `<bucket>.s3.<region>.amazonaws.com`, read at build time) plus the GitHub and Google avatar hosts. Any other image host makes `next/image` throw, so new image sources must be added there.
