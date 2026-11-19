// Error codes that authorize() throws and the login form maps to messages.
// Kept apart from auth.ts so client components can import them without pulling in bcrypt/Prisma.
export const TOO_MANY_ATTEMPTS = "TOO_MANY_ATTEMPTS";
// the password was right, but the account's email isn't verified yet (app/libs/email-verification.ts)
export const EMAIL_NOT_VERIFIED = "EMAIL_NOT_VERIFIED";
