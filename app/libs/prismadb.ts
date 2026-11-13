import { PrismaClient } from "@prisma/client";

// hashedPassword is never returned unless a query opts back in with
// `omit: { hashedPassword: false }` (only the credentials login does).
const createClient = () =>
  new PrismaClient({ omit: { user: { hashedPassword: true } } });

type AppPrismaClient = ReturnType<typeof createClient>;

declare global {
  var prisma: AppPrismaClient | undefined;
}

const client = globalThis.prisma || createClient();
if (process.env.NODE_ENV !== "production") globalThis.prisma = client;

export default client;
