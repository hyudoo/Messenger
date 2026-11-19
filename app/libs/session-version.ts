import prisma from "./prismadb";
import { logError } from "./log";

// Which session tokens (JWTs) are still good. Each token carries the user's `sessionVersion` from
// when it was issued (claim `sv`, set by the jwt callback in app/libs/auth.ts); changing the password
// or "sign out other devices" bumps the version (app/libs/sessions.ts), so older tokens stop
// working everywhere: the session callback, proxy.ts and the socket server all ask isSessionCurrent.
//
// The session callback runs on every getServerSession, so the version is cached per user for a
// short while. A revocation updates the cache here and, through "sessions:revoked", on the other
// instances; the TTL only bounds a missed message.
const CACHE_MS = 30_000;

declare global {
  // user id -> their session version (null: no such user), shared by route handlers, proxy.ts and
  // the socket server (one process, separate module copies)
  var sessionVersionCache:
    | Map<string, { at: number; version: Promise<number | null> }>
    | undefined;
}

const cache = () => (globalThis.sessionVersionCache ??= new Map());

const OBJECT_ID = /^[0-9a-f]{24}$/;

const loadVersion = async (userId: string): Promise<number | null> => {
  if (!OBJECT_ID.test(userId)) {
    return null;
  }
  const row = await prisma.user.findUnique({
    where: { id: userId },
    select: { sessionVersion: true },
  });
  return row ? (row.sessionVersion ?? 0) : null;
};

// The user's current session version, or null when the user no longer exists. `fresh` skips the
// cache (sign-in, socket connections, revoking).
export const currentSessionVersion = (
  userId: string,
  { fresh = false }: { fresh?: boolean } = {}
): Promise<number | null> => {
  const hit = cache().get(userId);
  if (!fresh && hit && Date.now() - hit.at < CACHE_MS) {
    return hit.version;
  }
  const entry = { at: Date.now(), version: loadVersion(userId) };
  cache().set(userId, entry);
  // a failed read isn't remembered
  entry.version.catch(() => {
    if (cache().get(userId) === entry) {
      cache().delete(userId);
    }
  });
  return entry.version;
};

// After a revocation: this instance knows the new version at once.
export const rememberSessionVersion = (userId: string, version: number) => {
  cache().set(userId, { at: Date.now(), version: Promise.resolve(version) });
};

export const forgetSessionVersion = (userId: string) => {
  cache().delete(userId);
};

// The version a token was issued with (tokens from before versions existed count as 0).
export const tokenSessionVersion = (token: { sv?: unknown }) =>
  typeof token.sv === "number" ? token.sv : 0;

// Whether this decoded session token is still good: its user exists and it was issued at the
// user's current version. A database error lets it through (the request then fails on its own
// queries, or works), so an outage doesn't sign everyone out.
export const isSessionCurrent = async (
  token: { sub?: unknown; sv?: unknown } | null | undefined,
  options?: { fresh?: boolean }
): Promise<boolean> => {
  if (!token || typeof token.sub !== "string") {
    return false;
  }
  try {
    const version = await currentSessionVersion(token.sub, options);
    return version !== null && version === tokenSessionVersion(token);
  } catch (error) {
    logError("session_version", error);
    return true;
  }
};

// The session cookie, named the way next-auth's getToken looks for it (proxy.ts, the socket server)
export const secureCookie = () =>
  process.env.NEXTAUTH_URL?.startsWith("https://") ?? !!process.env.VERCEL;
export const sessionCookieName = () =>
  `${secureCookie() ? "__Secure-" : ""}next-auth.session-token`;
