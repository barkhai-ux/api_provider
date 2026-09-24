import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { clientIp, isSameOrigin } = await import("./http");

function request(headers: Record<string, string>) {
  return new NextRequest("http://0.0.0.0:3000/api/playground/token", { method: "POST", headers });
}

describe("isSameOrigin", () => {
  it("accepts requests whose Origin matches the Host header", () => {
    expect(isSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "same-origin" }))).toBe(true);
  });

  it("uses X-Forwarded-Host behind a reverse proxy", () => {
    expect(isSameOrigin(request({ origin: "https://geo.example.com", host: "web:3000", "x-forwarded-host": "geo.example.com" }))).toBe(true);
  });

  it("rejects cross-site requests", () => {
    expect(isSameOrigin(request({ origin: "https://evil.example", host: "localhost:3000" }))).toBe(false);
    expect(isSameOrigin(request({ origin: "http://localhost:3000", host: "localhost:3000", "sec-fetch-site": "cross-site" }))).toBe(false);
    expect(isSameOrigin(request({ host: "localhost:3000" }))).toBe(false);
  });
});

describe("clientIp", () => {
  it("uses the right-most X-Forwarded-For entry", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.9, 198.51.100.2" }))).toBe("198.51.100.2");
  });

  it("ignores malformed values", () => {
    expect(clientIp(request({ "x-forwarded-for": "not an ip<script>" }))).toBeUndefined();
  });

  it("prefers the trusted header named by CLIENT_IP_HEADER", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    try {
      const headers = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "203.0.113.9, 10.0.0.1" };
      expect(clientIp(request(headers))).toBe("203.0.113.9");
      // Falls back to X-Forwarded-For when the trusted header is missing.
      expect(clientIp(request({ "x-forwarded-for": "10.0.0.1" }))).toBe("10.0.0.1");
    } finally {
      vi.unstubAllEnvs();
    }
  });
});
