import { afterEach, describe, expect, it, vi } from "vitest";

import robots from "@/app/robots";
import sitemap from "@/app/sitemap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("sitemap.xml", () => {
  it("lists the public pages in every locale with hreflang alternates", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://chat.example.com/");
    const entries = sitemap();
    expect(entries.map((entry) => entry.url)).toEqual([
      "https://chat.example.com/vi",
      "https://chat.example.com/en",
      "https://chat.example.com/vi/privacy",
      "https://chat.example.com/en/privacy",
      "https://chat.example.com/vi/terms",
      "https://chat.example.com/en/terms",
    ]);
    expect(entries[1].alternates?.languages).toEqual({
      vi: "https://chat.example.com/vi",
      en: "https://chat.example.com/en",
      "x-default": "https://chat.example.com/vi",
    });
  });
});

describe("robots.txt", () => {
  it("keeps the API and signed-in pages out and points to the sitemap", () => {
    vi.stubEnv("NEXTAUTH_URL", "https://chat.example.com");
    const result = robots();
    const rules = Array.isArray(result.rules) ? result.rules[0] : result.rules;
    expect(rules.disallow).toEqual(
      expect.arrayContaining(["/api/", "/vi/conversations", "/en/room", "/vi/reset-password"])
    );
    expect(result.sitemap).toBe("https://chat.example.com/sitemap.xml");
  });
});
