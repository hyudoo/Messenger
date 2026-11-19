import { createHash } from "crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// nodemailer itself is never reached: the route's mail goes through this mock
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mocks.sendMail }) },
}));

import { POST as forgot } from "@/app/api/password/forgot/route";
import { POST as reset } from "@/app/api/password/reset/route";

const me = user(ME);
const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const ask = (body: unknown, ip = "1.2.3.4") =>
  forgot(jsonRequest("/api/password/forgot", body, { ip }));
const set = (body: unknown) =>
  reset(jsonRequest("/api/password/reset", body));

let prisma: ReturnType<typeof createPrismaMock>;

beforeEach(() => {
  vi.clearAllMocks();
  resetRateLimits();
  prisma = mocks.prisma = createPrismaMock();
  mocks.sendMail.mockResolvedValue({});
  vi.stubEnv("NEXTAUTH_URL", "https://chat.example.com/");
  vi.stubEnv("SMTP_HOST", "smtp.example.com");
  vi.stubEnv("SMTP_FROM", "Messenger <no-reply@example.com>");
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/password/forgot", () => {
  it("mails a one-time link built on NEXTAUTH_URL (never the Host header), in the asked language", async () => {
    prisma.user.findFirst.mockResolvedValue(me);

    expect((await ask({ email: me.email, locale: "en" })).status).toBe(200);

    // earlier links go, the new one is stored as a hash only
    expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { userId: ME } });
    const { data } = prisma.passwordReset.create.mock.calls[0][0];
    expect(data.userId).toBe(ME);
    expect(data.expiresAt.getTime()).toBeGreaterThan(Date.now());
    const mail = mocks.sendMail.mock.calls[0][0];
    expect(mail.to).toBe(me.email);
    expect(mail.subject).toBe("Reset your Messenger password");
    const token = /reset-password\?token=([\w-]{43})/.exec(mail.text)![1];
    expect(mail.text).toContain(`https://chat.example.com/en/reset-password?token=${token}`);
    expect(data.tokenHash).toBe(sha(token));
    expect(mail.text).not.toContain(data.tokenHash);
  });

  it("answers the same for an unknown address, and sends nothing", async () => {
    prisma.user.findFirst.mockResolvedValue(null);
    const response = await ask({ email: "nobody@example.com", locale: "vi" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(mocks.sendMail).not.toHaveBeenCalled();
    expect(prisma.passwordReset.create).not.toHaveBeenCalled();
  });

  it("refuses a bad address, and limits requests per address", async () => {
    expect((await ask({ email: "not-an-email" })).status).toBe(400);
    prisma.user.findFirst.mockResolvedValue(me);
    for (let i = 0; i < 3; i++) {
      expect((await ask({ email: me.email }, `10.0.0.${i}`)).status).toBe(200);
    }
    // a fourth from yet another IP: the address's own limit
    expect((await ask({ email: me.email }, "10.0.0.9")).status).toBe(429);
  });

  it("is off in production without SMTP or NEXTAUTH_URL", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SMTP_HOST", "");
    expect((await ask({ email: me.email })).status).toBe(503);
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("NEXTAUTH_URL", "");
    expect((await ask({ email: me.email })).status).toBe(503);
    expect(prisma.user.findFirst).not.toHaveBeenCalled();
  });
});

describe("POST /api/password/reset", () => {
  const TOKEN = "A".repeat(43);

  it("sets the new password once, every link stops working and every session ends", async () => {
    prisma.passwordReset.findUnique.mockResolvedValue({
      userId: ME,
      expiresAt: new Date(Date.now() + 60_000),
    });
    prisma.user.findUnique.mockResolvedValue({ sessionVersion: 4 });
    prisma.user.update.mockResolvedValue(me);

    expect((await set({ token: TOKEN, password: "New-passw0rd!" })).status).toBe(200);
    expect(prisma.passwordReset.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { tokenHash: sha(TOKEN) } })
    );
    const { data } = prisma.user.update.mock.calls[0][0];
    expect(data.hashedPassword).toMatch(/^\$2[aby]\$12\$/);
    expect(data.hashedPassword).not.toContain("New-passw0rd!");
    expect(data.sessionVersion).toBe(5);
    // the mailed link proves the address too
    expect(data.emailVerified).toBeInstanceOf(Date);
    expect(prisma.passwordReset.deleteMany).toHaveBeenCalledWith({ where: { userId: ME } });
  });

  it("refuses weak passwords, unknown, malformed and expired links", async () => {
    expect(await (await set({ token: TOKEN, password: "short" })).text()).toBe("too_short");
    expect(await (await set({ token: "nope", password: "New-passw0rd!" })).text()).toBe("invalid_token");
    prisma.passwordReset.findUnique.mockResolvedValue(null);
    expect(await (await set({ token: TOKEN, password: "New-passw0rd!" })).text()).toBe("invalid_token");
    prisma.passwordReset.findUnique.mockResolvedValue({ userId: ME, expiresAt: new Date(Date.now() - 1) });
    expect(await (await set({ token: TOKEN, password: "New-passw0rd!" })).text()).toBe("invalid_token");
    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
