import { createHash, randomBytes } from "crypto";

import prisma from "./prismadb";

// "Forgot password" links: /<locale>/reset-password?token=<token>. The token is 32 random bytes;
// only its SHA-256 is stored (PasswordReset.tokenHash), it works once, for RESET_TTL_MS, and asking
// again replaces the user's earlier links.

export const RESET_TTL_MS = 30 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

const hashOf = (token: string) => createHash("sha256").update(token).digest("hex");

// a new link's token for the user (their earlier ones stop working)
export const createResetToken = async (userId: string) => {
  const token = randomBytes(32).toString("base64url");
  await prisma.passwordReset.deleteMany({ where: { userId } });
  await prisma.passwordReset.create({
    data: { userId, tokenHash: hashOf(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    select: { id: true },
  });
  return token;
};

// The user a token resets, or null when it is malformed, unknown, used or expired.
export const userOfResetToken = async (token: unknown) => {
  if (typeof token !== "string" || !TOKEN.test(token)) {
    return null;
  }
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashOf(token) },
    select: { userId: true, expiresAt: true },
  });
  return reset && reset.expiresAt.getTime() > Date.now() ? reset.userId : null;
};

// after a reset: no link of the user's works any more
export const clearResetTokens = (userId: string) =>
  prisma.passwordReset.deleteMany({ where: { userId } });
