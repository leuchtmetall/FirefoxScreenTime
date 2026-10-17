import { describe, expect, test } from "bun:test";
import {
  hostnameFromUrl,
  hostnameMatches,
  isTrackedUrl,
  normalizeHostname,
  normalizeHostnames,
} from "../src/shared/urls.ts";

describe("URL configuration", () => {
  test("normalizes URLs and bare hostnames", () => {
    expect(normalizeHostname(" HTTPS://News.Example.COM/path?q=1 ")).toBe("news.example.com");
    expect(normalizeHostname("example.com/articles")).toBe("example.com");
  });

  test("rejects unsupported and invalid values", () => {
    expect(() => normalizeHostname("ftp://example.com")).toThrow("Only HTTP and HTTPS");
    expect(() => normalizeHostname(" ")).toThrow("cannot be empty");
  });

  test("deduplicates and sorts hostnames", () => {
    expect(normalizeHostnames(["b.example", "https://a.example/x", "B.EXAMPLE"])).toEqual([
      "a.example",
      "b.example",
    ]);
  });

  test("matches a hostname and its subdomains without matching suffix lookalikes", () => {
    expect(hostnameMatches("example.com", "example.com")).toBe(true);
    expect(hostnameMatches("news.example.com", "example.com")).toBe(true);
    expect(hostnameMatches("notexample.com", "example.com")).toBe(false);
  });

  test("only extracts web hostnames", () => {
    expect(hostnameFromUrl("https://example.com/a")).toBe("example.com");
    expect(hostnameFromUrl("about:config")).toBeUndefined();
    expect(isTrackedUrl("https://deep.example.com", ["example.com"])).toBe(true);
  });
});
