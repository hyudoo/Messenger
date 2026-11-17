import { NextResponse } from "next/server";

import prisma from "@/app/libs/prismadb";

// Liveness / readiness for Docker's HEALTHCHECK and the deploy job: 200 once the database answers
// and the socket.io server is running (started by server.ts), 503 otherwise. Public and cheap; it
// says which part failed but nothing else about the setup.
export const dynamic = "force-dynamic";

const DB_TIMEOUT_MS = 3000;

const pingDatabase = async () => {
  try {
    await Promise.race([
      prisma.$runCommandRaw({ ping: 1 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("database ping timed out")), DB_TIMEOUT_MS)
      ),
    ]);
    return true;
  } catch (error) {
    console.log(error, "ERROR_HEALTH_DATABASE");
    return false;
  }
};

export async function GET() {
  const database = await pingDatabase();
  const socket = !!globalThis.io;
  const ok = database && socket;

  return NextResponse.json(
    { status: ok ? "ok" : "error", database, socket },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } }
  );
}
