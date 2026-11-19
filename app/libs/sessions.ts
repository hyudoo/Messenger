import type { Prisma } from "@prisma/client";
import { encode } from "next-auth/jwt";
import type { NextResponse } from "next/server";

import prisma from "./prismadb";
import {
  currentSessionVersion,
  rememberSessionVersion,
  secureCookie,
  sessionCookieName,
} from "./session-version";
import { notifySessionsRevoked } from "./socket-server";

// next-auth's default session length (app/libs/auth.ts doesn't change it), seconds
const SESSION_MAX_AGE = 30 * 24 * 60 * 60;

// Ends every session of the user (see app/libs/session-version.ts): bumps their session version,
// with `data` written in the same update (e.g. the new password hash), and drops their sockets on
// every instance. Returns the user and the new version, for reissueSession.
export const revokeSessions = async (
  userId: string,
  data: Prisma.UserUpdateInput = {}
) => {
  // set rather than increment: $inc fails on a stored null. Two revocations at once both end the
  // older sessions, which is all that matters.
  const version = ((await currentSessionVersion(userId, { fresh: true })) ?? 0) + 1;
  const user = await prisma.user.update({
    where: { id: userId },
    data: { ...data, sessionVersion: version },
    select: { id: true, email: true, name: true, image: true },
  });
  rememberSessionVersion(userId, version);
  if (user.email) {
    notifySessionsRevoked(userId, user.email);
  }
  return { user, version };
};

// Keeps the device that asked signed in after revokeSessions: sets its session cookie to a new
// token at the new version, with the claims next-auth's own tokens carry.
export const reissueSession = async (
  response: NextResponse,
  user: { id: string; email: string | null; name: string | null; image: string | null },
  version: number
) => {
  const token = await encode({
    token: { sub: user.id, email: user.email, name: user.name, picture: user.image, sv: version },
    secret: process.env.NEXTAUTH_SECRET as string,
    maxAge: SESSION_MAX_AGE,
  });
  response.cookies.set(sessionCookieName(), token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    secure: secureCookie(),
    maxAge: SESSION_MAX_AGE,
  });
  return response;
};
