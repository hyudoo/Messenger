import bcrypt from "bcrypt";
import { createHash } from "crypto";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { ME, createPrismaMock, jsonRequest, resetRateLimits, user } from "../helpers";

const mocks = vi.hoisted(() => ({
  prisma: undefined as unknown as ReturnType<typeof import("../helpers").createPrismaMock>,
  sendMail: vi.fn(),
}));

vi.mock("@/app/libs/prismadb", () => ({
  get default() {
    return mocks.prisma;
  },
}));
// nodemailer itself is never reached: the routes' mail goes through this mock
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));

import { POST as register } from "@/app/api/register/route";
import { POST as verify } from "@/app/api/email/verify/route";
import { POST as resend } from "@/app/api/email/resend/route";
import { authOptions } from "@/app/libs/auth";
import { EMAIL_NOT_VERIFIED } from "@/app/libs/auth-errors";

const me = user(ME);
const PASSWORD = "Abcdef1!";
const TOKEN = "B".repeat(43);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const signUp = (body: Record<string, unknown>) => register(jsonRequest("/api/register", body));
const open = (token: unknown) => verify(jsonRequest("/api/email/verify", { token }));
const askAgain = (email: string, ip = "1.2.3.4") =>
  resend(jsonRequest("/api/email/resend", { email, locale: "en" }, { ip }));

let prisma: ReturnType<typeof createPrismaMock>;
let storedHash: string;

beforeAll(async () => {
  storedHash = await bcrypt.hash(PASSWORD, 4);
});

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  prisma = mocks.prisma = createPrismaMock();
  mocks.sendMail.mockResolvedValue({});
  vi.stubEnv("NEXTAUTH_URL", "https://chat.example.com");
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_FROM", "Messenger <no-reply@example.com>");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/register", () => {
  const valid = { email: "new@example.com", name: "New", password: PASSWORD, locale: "en" };

  it("creates an account that must verify its email and mails it a one-time link", async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    prisma.user.create.mockResolvedValue({ id: ME, email: valid.email, name: "New" });

    const response = await signUp(valid);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ email: valid.email, verify: true });

    expect(prisma.user.create.mock.calls[0][0].data.mustVerifyEmail).toBe(true);
    const { data } = prisma.emailVerification.create.mock.calls[0][0];
    expect(data.userId).toBe(ME);
    expect(data.expiresAt.getTime() - Date.now()).toBeGreaterThan(23 * 3_600_000);
    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.to).toBe(valid.email);
    expect(mail.subject).toBe("Verify the email of your Messenger account");
    const token = /verify-email\?token=([\w-]{43})/.exec(mail.text)![1];
    expect(mail.text).toContain(`https://chat.example.com/en/verify-email?token=${token}`);
    expect(data.tokenHash).toBe(sha(token));
  });

  it("refuses to create accounts nobody could verify (production without SMTP)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "");
    expect((await signUp(valid)).status).toBe(503);
    expect(prisma.user.create).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/verify", () => {
  it("verifies the email once and ends the user's links", async () => {
    prisma.emailVerification.findUnique.mockResolvedValue({
      userId: ME,
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await open(TOKEN)).status).toBe(200);
    expect(prisma.emailVerification.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha(TOKEN) } })
    );
    expect(prisma.user.update.mock.calls[0][0]).toMatchObject({
      where: { id: ME },
      data: { emailVerified: expect.any(Date) },
    });
    expect(prisma.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: ME } });
  });

  it("refuses malformed, unknown and expired links", async () => {
    expect(await (await open("nope")).text()).toBe("invalid_token");
    prisma.emailVerification.findUnique.mockResolvedValue(null);
    expect(await (await open(TOKEN)).text()).toBe("invalid_token");
    prisma.emailVerification.findUnique.mockResolvedValue({ userId: ME, expiresAt: new Date(Date.now() - 1) });
    expect(await (await open(TOKEN)).text()).toBe("invalid_token");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});

describe("POST /api/email/resend", () => {
  it("mails a new link to an account still waiting, the same answer for anyone else", async () => {
    prisma.user.findFirst.mockResolvedValueOnce({ ...me, mustVerifyEmail: true, emailVerified: null });
    expect(await (await askAgain(me.email)).json()).toEqual({ ok: true });
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
    expect(prisma.emailVerification.deleteMany).toHaveBeenCalledWith({ where: { userId: ME } });

    // verified, an older account, nobody: nothing sent, same answer
    prisma.user.findFirst.mockResolvedValueOnce({ ...me, mustVerifyEmail: true, emailVerified: new Date() });
    prisma.user.findFirst.mockResolvedValueOnce({ ...me, mustVerifyEmail: null, emailVerified: null });
    prisma.user.findFirst.mockResolvedValueOnce(null);
    for (const ip of ["1.1.1.1", "2.2.2.2", "3.3.3.3"]) {
      const response = await askAgain(`other-${ip}@example.com`, ip);
      expect(await response.json()).toEqual({ ok: true });
    }
    expect(mocks.sendMail).toHaveBeenCalledTimes(1);
  });

  it("limits mails per address, from any IP", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    for (let i = 0; i < 3; i++) {
      expect((await askAgain(me.email, `10.0.0.${i}`)).status).toBe(200);
    }
    expect((await askAgain(me.email, "10.0.0.9")).status).toBe(429);
  });
});

describe("signing in with a password", () => {
  const authorize = (authOptions.providers[2] as any).options.authorize as (
    credentials: Record<string, string>,
    req: unknown
  ) => Promise<unknown>;
  const signIn = () =>
    authorize({ email: me.email, password: PASSWORD }, { headers: { "x-client-ip": "5.5.5.5" } });
  const stored = (extra: Record<string, unknown>) =>
    prisma.user.findUnique.mockResolvedValue({ ...me, hashedPassword: storedHash, ...extra });

  it("holds back an account until its email is verified", async () => {
    stored({ mustVerifyEmail: true, emailVerified: null });
    await expect(signIn()).rejects.toThrow(EMAIL_NOT_VERIFIED);
  });

  it("lets verified and older accounts in, without the private fields", async () => {
    stored({ mustVerifyEmail: true, emailVerified: new Date() });
    const signedIn = (await signIn()) as Record<string, unknown>;
    expect(signedIn.id).toBe(ME);
    expect(signedIn).not.toHaveProperty("hashedPassword");
    expect(signedIn).not.toHaveProperty("mustVerifyEmail");
    stored({ mustVerifyEmail: null, emailVerified: null });
    expect(await signIn()).toMatchObject({ id: ME });
  });

  it("says nothing about verification to a wrong password", async () => {
    stored({ mustVerifyEmail: true, emailVerified: null });
    await expect(
      authorize({ email: me.email, password: "Wrong-pass1" }, { headers: {} })
    ).rejects.toThrow("Invalid credentials");
  });
});
