import bcrypt from "bcrypt";
import { decode } from "next-auth/jwt";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ME, createPrismaMock, jsonRequest, resetRateLimits, user } from "../helpers";

const mocks = vi.hoisted(() => ({
  prisma: undefined as unknown as ReturnType<typeof import("../helpers").createPrismaMock>,
  currentUser: vi.fn(),
  notifySessionsRevoked: vi.fn(),
}));

vi.mock("@/app/libs/prismadb", () => ({
  get default() {
    return mocks.prisma;
  },
}));
vi.mock("@/app/actions/getCurrentUser", () => ({ default: mocks.currentUser }));
vi.mock("@/app/libs/socket-server", () => ({
  notifySessionsRevoked: mocks.notifySessionsRevoked,
}));

import { POST as changePassword } from "@/app/api/password/change/route";
import { DELETE as signOutOthers } from "@/app/api/settings/sessions/route";
import { authOptions } from "@/app/libs/auth";
import { isSessionCurrent } from "@/app/libs/session-version";

const SECRET = "test-secret";
const me = user(ME);
const NEW_PASSWORD = "N3w-password";
const change = (body: unknown) => changePassword(jsonRequest("/api/password/change", body));

let prisma: ReturnType<typeof createPrismaMock>;
let storedHash: string;

// the session cookie a response sets, decoded
const issuedToken = async (response: Response) => {
  const cookie = response.headers.get("set-cookie") ?? "";
  const value = /next-auth\.session-token=([^;]+)/.exec(cookie)?.[1];
  return value ? decode({ token: value, secret: SECRET }) : null;
};

beforeAll(async () => {
  storedHash = await bcrypt.hash("0ld-Password", 4);
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  globalThis.sessionVersionCache?.clear();
  vi.stubEnv("NEXTAUTH_SECRET", SECRET);
  vi.stubEnv("NEXTAUTH_URL", "http://localhost:3000");
  prisma = mocks.prisma = createPrismaMock();
  mocks.currentUser.mockResolvedValue(me);
  // the stored user: version 2, with a password
  prisma.user.findUnique.mockImplementation(async ({ select }: any) =>
    select?.hashedPassword ? { hashedPassword: storedHash } : { sessionVersion: 2 }
  );
  prisma.user.update.mockResolvedValue({ id: ME, email: me.email, name: me.name, image: null });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/password/change", () => {
  it("sets the new password, ends every session and keeps this device signed in", async () => {
    const response = await change({ currentPassword: "0ld-Password", newPassword: NEW_PASSWORD });
    expect(response.status).toBe(200);

    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.sessionVersion).toBe(3);
    expect(await bcrypt.compare(NEW_PASSWORD, data.hashedPassword)).toBe(true);
    expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { userId: ME } });
    expect(mocks.notifySessionsRevoked).toHaveBeenCalledWith(ME, me.email);

    // this device's new cookie carries the new version; an old token is refused
    const token = await issuedToken(response);
    expect(token).toMatchObject({ sub: ME, email: me.email, sv: 3 });
    expect(await isSessionCurrent(token)).toBe(true);
    expect(await isSessionCurrent({ sub: ME, sv: 2 })).toBe(false);
  });

  it("refuses a wrong current password and changes nothing", async () => {
    const response = await change({ currentPassword: "Wrong-pass1", newPassword: NEW_PASSWORD });
    expect(response.status).toBe(400);
    expect(await response.text()).toBe("wrong_password");
    expect(prisma.user.update).not.toHaveBeenCalled();
    expect(mocks.notifySessionsRevoked).not.toHaveBeenCalled();
  });

  it("answers with the broken password rule", async () => {
    const response = await change({ currentPassword: "0ld-Password", newPassword: "short" });
    expect(await response.text()).toBe("too_short");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it("tells an account without a password to set one by email", async () => {
    prisma.user.findUnique.mockResolvedValue({ hashedPassword: null });
    const response = await change({ currentPassword: "x", newPassword: NEW_PASSWORD });
    expect(await response.text()).toBe("no_password");
  });

  it("needs a signed-in user and limits tries", async () => {
    mocks.currentUser.mockResolvedValueOnce(null);
    expect((await change({})).status).toBe(401);
    for (let i = 0; i < 5; i++) {
      await change({ currentPassword: "Wrong-pass1", newPassword: NEW_PASSWORD });
    }
    expect((await change({ currentPassword: "0ld-Password", newPassword: NEW_PASSWORD })).status).toBe(429);
  });
});

describe("DELETE /api/settings/sessions", () => {
  it("ends every session but gives this device a new one", async () => {
    const response = await signOutOthers();
    expect(response.status).toBe(200);
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data).toEqual({ sessionVersion: 3 });
    expect((await issuedToken(response))?.sv).toBe(3);
    expect(mocks.notifySessionsRevoked).toHaveBeenCalledWith(ME, me.email);
  });
});

describe("session version checks", () => {
  it("accepts tokens at the current version, counting a missing one as 0", async () => {
    prisma.user.findUnique.mockResolvedValue({ sessionVersion: null });
    expect(await isSessionCurrent({ sub: ME })).toBe(true);
    expect(await isSessionCurrent({ sub: ME, sv: 1 })).toBe(false);
  });

  it("refuses a deleted user's token, and lets one through on a database error", async () => {
    prisma.user.findUnique.mockResolvedValueOnce(null);
    expect(await isSessionCurrent({ sub: ME, sv: 0 }, { fresh: true })).toBe(false);
    prisma.user.findUnique.mockRejectedValueOnce(new Error("down"));
    expect(await isSessionCurrent({ sub: ME, sv: 0 }, { fresh: true })).toBe(true);
    expect(await isSessionCurrent({ sub: "not-an-id" })).toBe(false);
  });

  it("gives an outdated token no session, and a new sign-in the current version", async () => {
    const session = { user: { email: me.email }, expires: "" };
    const callbacks = authOptions.callbacks!;
    expect(await callbacks.session!({ session, token: { sub: ME, sv: 1 } } as any)).toEqual({});
    expect(await callbacks.session!({ session, token: { sub: ME, sv: 2 } } as any)).toBe(session);
    const token = await callbacks.jwt!({ token: { sub: ME }, user: { id: ME } } as any);
    expect(token.sv).toBe(2);
  });
});
