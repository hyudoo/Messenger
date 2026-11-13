import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("next-auth/jwt", () => ({ getToken: mocks.getToken }));

import proxy from "@/proxy";

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

const location = (response: Response) => {
  const value = response.headers.get("location");
  return value ? new URL(value).pathname : null;
};

describe("proxy", () => {
  beforeEach(() => {
    mocks.getToken.mockReset();
    mocks.getToken.mockResolvedValue(null);
  });

  it("sends / to the default locale", async () => {
    expect(location(await proxy(request("/")))).toBe("/vi");
  });

  it("picks the locale from the language cookie", async () => {
    const response = await proxy(request("/", { cookie: "NEXT_LOCALE=en" }));
    expect(location(response)).toBe("/en");
  });

  it.each([
    ["/vi/conversations", "/vi"],
    ["/en/conversations/abc", "/en"],
    ["/en/users", "/en"],
    ["/vi/room/abc", "/vi"],
  ])("sends signed-out users from %s to the login page %s", async (path, login) => {
    expect(location(await proxy(request(path)))).toBe(login);
  });

  it("uses the cookie language when a protected path has no locale", async () => {
    const response = await proxy(request("/conversations", { cookie: "NEXT_LOCALE=en" }));
    expect(location(response)).toBe("/en");
  });

  it("lets signed-in users through to protected pages", async () => {
    mocks.getToken.mockResolvedValue({ sub: "user-id", email: "me@example.com" });
    const response = await proxy(request("/en/conversations"));
    expect(location(response)).toBeNull();
    expect(response.status).toBe(200);
  });

  it("keeps the login page open to signed-out users", async () => {
    const response = await proxy(request("/en"));
    expect(location(response)).toBeNull();
    expect(mocks.getToken).not.toHaveBeenCalled();
  });

  it("does not treat a path that merely starts like a protected one as protected", async () => {
    await proxy(request("/vi/usersettings"));
    expect(mocks.getToken).not.toHaveBeenCalled();
  });
});
