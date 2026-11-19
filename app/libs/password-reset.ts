import { hashLinkToken, isLinkToken, newLinkToken } from "./link-token";
import prisma from "./prismadb";

// "Forgot password" links: /<locale>/reset-password?token=<token>. The token is 32 random bytes;
// only its SHA-256 is stored (PasswordReset.tokenHash), it works once, for RESET_TTL_MS, and asking
// again replaces the user's earlier links.

export const RESET_TTL_MS = 30 * 60 * 1000;

// a new link's token for the user (their earlier ones stop working)
export const createResetToken = async (userId: string) => {
  const token = newLinkToken();
  await prisma.passwordReset.deleteMany({ where: { userId } });
  await prisma.passwordReset.create({
    data: { userId, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() + RESET_TTL_MS) },
    select: { id: true },
  });
  return token;
};

// The user a token resets, or null when it is malformed, unknown, used or expired.
export const userOfResetToken = async (token: unknown) => {
  if (!isLinkToken(token)) {
    return null;
  }
  const reset = await prisma.passwordReset.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: { userId: true, expiresAt: true },
  });
  return reset && reset.expiresAt.getTime() > Date.now() ? reset.userId : null;
};

// after a reset: no link of the user's works any more
export const clearResetTokens = (userId: string) =>
  prisma.passwordReset.deleteMany({ where: { userId } });
