import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  afterEach(() => vi.unstubAllEnvs());

  it("trusts no forwarding header unless configured (fail closed)", () => {
    expect(clientIp(request({ "x-forwarded-for": "203.0.113.9", "x-real-ip": "203.0.113.9" }))).toBeUndefined();
  });

  it("uses only the header named by CLIENT_IP_HEADER, without falling back", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "CF-Connecting-IP");
    const headers = { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "198.51.100.2" };
    expect(clientIp(request(headers))).toBe("203.0.113.9");
    // A spoofed X-Forwarded-For must not stand in for the missing trusted header.
    expect(clientIp(request({ "x-forwarded-for": "198.51.100.2" }))).toBeUndefined();
  });

  it("counts trusted proxies from the right with TRUSTED_PROXY_HOPS", () => {
    vi.stubEnv("TRUSTED_PROXY_HOPS", "1");
    // The client sent "1.2.3.4"; the trusted proxy appended the real address.
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, 203.0.113.9" }))).toBe("203.0.113.9");
    vi.stubEnv("TRUSTED_PROXY_HOPS", "2");
    expect(clientIp(request({ "x-forwarded-for": "1.2.3.4, 203.0.113.9, 10.0.0.1" }))).toBe("203.0.113.9");
    expect(clientIp(request({ "x-forwarded-for": "10.0.0.1" }))).toBeUndefined();
  });

  it("ignores malformed values", () => {
    vi.stubEnv("CLIENT_IP_HEADER", "x-real-ip");
    expect(clientIp(request({ "x-real-ip": "not an ip<script>" }))).toBeUndefined();
  });
});
