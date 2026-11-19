import { hashLinkToken, isLinkToken, newLinkToken } from "./link-token";
import prisma from "./prismadb";

// "Verify your email" links: /<locale>/verify-email?token=<token>, mailed when someone registers
// with a password (and again on request). Like the password reset links (app/libs/password-reset.ts):
// only the token's SHA-256 is stored (EmailVerification.tokenHash), it works once, for
// VERIFY_TTL_MS, and a new link replaces the user's earlier ones.
// Until then such an account can't sign in (User.mustVerifyEmail, checked in app/libs/auth.ts).

export const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;

// whether an account with these fields is still held back from signing in
export const needsEmailVerification = (user: {
  mustVerifyEmail?: boolean | null;
  emailVerified?: Date | null;
}) => !!user.mustVerifyEmail && !user.emailVerified;

// a new link's token for the user (their earlier ones stop working)
export const createVerificationToken = async (userId: string) => {
  const token = newLinkToken();
  await prisma.emailVerification.deleteMany({ where: { userId } });
  await prisma.emailVerification.create({
    data: { userId, tokenHash: hashLinkToken(token), expiresAt: new Date(Date.now() + VERIFY_TTL_MS) },
    select: { id: true },
  });
  return token;
};

// Marks the email of the token's user verified and ends every link of theirs. false when the token
// is malformed, unknown, used or expired.
export const verifyEmailToken = async (token: unknown) => {
  if (!isLinkToken(token)) {
    return false;
  }
  const link = await prisma.emailVerification.findUnique({
    where: { tokenHash: hashLinkToken(token) },
    select: { userId: true, expiresAt: true },
  });
  if (!link || link.expiresAt.getTime() <= Date.now()) {
    return false;
  }
  await prisma.user.update({
    where: { id: link.userId },
    data: { emailVerified: new Date() },
    select: { id: true },
  });
  await prisma.emailVerification.deleteMany({ where: { userId: link.userId } });
  return true;
};
