import { createServer } from "http";
import type { AddressInfo } from "net";
import { describe, expect, it } from "vitest";

import {
  fetchPage,
  fetchPreviewImage,
  firstLink,
  isFetchableUrl,
  isPublicAddress,
  parsePreview,
  safeLookup,
} from "@/app/libs/link-preview";

describe("isPublicAddress", () => {
  it.each([
    "10.1.2.3",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "255.255.255.255",
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "64:ff9b::a00:1",
    "not an ip",
  ])("refuses %s", (address) => {
    expect(isPublicAddress(address)).toBe(false);
  });

  it.each(["8.8.8.8", "172.32.0.1", "1.1.1.1", "2606:4700:4700::1111", "::ffff:8.8.8.8"])(
    "accepts %s",
    (address) => {
      expect(isPublicAddress(address)).toBe(true);
    }
  );
});

describe("isFetchableUrl", () => {
  it.each([
    "https://example.com/a",
    "http://example.com:80/",
    "https://8.8.8.8/",
  ])("accepts %s", (url) => expect(isFetchableUrl(url)).toBe(true));

  it.each([
    "ftp://example.com/",
    "https://user:pass@example.com/",
    "https://example.com:8443/",
    "http://localhost/",
    "http://127.0.0.1/",
    "http://[::1]/",
    "http://intranet/",
    "javascript:alert(1)",
    "nonsense",
  ])("refuses %s", (url) => expect(isFetchableUrl(url)).toBe(false));
});

describe("parsePreview", () => {
  it("reads Open Graph tags, decodes entities and resolves the image", () => {
    const html = `<html><head>
      <meta property="og:title" content="Tom &amp; Jerry &#8212; ok">
      <meta content='A cat, a mouse' property='og:description'>
      <meta property="og:image" content="/img/cover.png">
      <meta property="og:site_name" content="Cartoons">
      <title>ignored</title></head><body><meta property="og:title" content="body"></body></html>`;
    expect(parsePreview(html, "https://example.com/page")).toEqual({
      url: "https://example.com/page",
      title: "Tom & Jerry — ok",
      description: "A cat, a mouse",
      image: "https://example.com/img/cover.png",
      siteName: "Cartoons",
    });
  });

  it("falls back to <title> and the host, and drops http images", () => {
    const html = `<head><title> Plain  page </title><meta name="description" content="d">
      <meta property="og:image" content="http://example.com/x.png"></head>`;
    expect(parsePreview(html, "https://www.example.com/")).toEqual({
      url: "https://www.example.com/",
      title: "Plain page",
      description: "d",
      image: null,
      siteName: "example.com",
    });
  });

  it("has nothing to show without a title", () => {
    expect(parsePreview("<head></head>", "https://example.com/")).toBeNull();
  });
});

describe("firstLink", () => {
  it("finds the first http(s) link", () => {
    expect(firstLink("see https://a.com/x, and https://b.com")).toBe("https://a.com/x");
    expect(firstLink("no links here")).toBeNull();
    expect(firstLink(null)).toBeNull();
  });
});

describe("fetching", () => {
  it("refuses a name that resolves to a private address when connecting", async () => {
    // localhost resolves from the hosts file (no network needed) to loopback addresses
    const error = await new Promise<NodeJS.ErrnoException | null>((resolve) =>
      safeLookup("localhost", {}, (lookupError) => resolve(lookupError))
    );
    expect(error?.code).toBe("EREFUSED");
  });

  it("never fetches a loopback server", async () => {
    let hits = 0;
    const server = createServer((_, response) => {
      hits += 1;
      response.setHeader("content-type", "text/html");
      response.end("<title>secret</title>");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address() as AddressInfo;
    try {
      await expect(fetchPage(`http://127.0.0.1:${port}/`)).resolves.toBeNull();
      await expect(fetchPage("http://127.0.0.1/")).resolves.toBeNull();
      await expect(fetchPreviewImage(`http://127.0.0.1:${port}/a.png`)).resolves.toBeNull();
      await expect(fetchPreviewImage("http://localhost/a.png")).resolves.toBeNull();
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});
