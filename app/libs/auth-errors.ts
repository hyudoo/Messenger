// Error codes that authorize() throws and the login form maps to messages.
// Kept apart from auth.ts so client components can import them without pulling in bcrypt/Prisma.
export const TOO_MANY_ATTEMPTS = "TOO_MANY_ATTEMPTS";
