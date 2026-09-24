import { describe, expect, it, vi } from "vitest";
import { GeoApiError, GeoClient } from "../src";

function reply(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } }),
  );
}

describe("GeoClient", () => {
  it("builds requests with the bearer key and query parameters", async () => {
    const fetch = reply({ query: "Sukhbaatar Square", results: [], count: 0 });
    const client = new GeoClient({ apiKey: "geo_live_x", baseUrl: "https://api.example.com/", fetch });
    await client.geocode({ q: "Sukhbaatar Square", limit: 5 });
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.example.com/v1/geocode?q=Sukhbaatar+Square&limit=5");
    expect(init.headers.Authorization).toBe("Bearer geo_live_x");
  });

  it("formats route coordinates as longitude,latitude", async () => {
    const fetch = reply({ route: {}, mode: "walking", waypoints: [] });
    await new GeoClient({ baseUrl: "/api", fetch }).route({
      origin: [106.9177, 47.9184],
      destination: "106.9057,47.922",
      mode: "walking",
    });
    expect(fetch.mock.calls[0][0]).toBe(
      "/api/v1/route?origin=106.9177%2C47.9184&destination=106.9057%2C47.922&mode=walking",
    );
    expect(fetch.mock.calls[0][1].headers.Authorization).toBeUndefined();
  });

  it("throws GeoApiError with the error envelope and rate-limit info", async () => {
    const fetch = reply(
      { error: { code: "RATE_LIMIT_EXCEEDED", message: "Too many requests.", details: { limit: 100 } } },
      429,
      { "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1790000000", "X-Request-ID": "abc" },
    );
    const client = new GeoClient({ apiKey: "k", fetch });
    const error = await client.reverseGeocode({ lat: 47.9, lon: 106.9 }).catch((e) => e);
    expect(error).toBeInstanceOf(GeoApiError);
    expect(error).toMatchObject({ status: 429, code: "RATE_LIMIT_EXCEEDED", requestId: "abc", details: { limit: 100 } });
    expect(error.rateLimit).toEqual({ limit: 100, remaining: 0, reset: 1790000000 });
    expect(error.retryable).toBe(true);
    expect(client.lastRateLimit?.remaining).toBe(0);
  });

  it("reports network failures and timeouts", async () => {
    const offline = new GeoClient({ fetch: vi.fn().mockRejectedValue(new TypeError("fetch failed")) });
    await expect(offline.geocode({ q: "ab" })).rejects.toMatchObject({ code: "NETWORK_ERROR", status: 0 });

    const hanging = vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(init.signal?.reason))),
    );
    const slow = new GeoClient({ timeoutMs: 10, fetch: hanging as unknown as typeof fetch });
    await expect(slow.geocode({ q: "ab" })).rejects.toMatchObject({ code: "REQUEST_TIMEOUT", status: 408 });
  });

  it("passes caller aborts through unchanged", async () => {
    const hanging = vi.fn((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))),
    );
    const controller = new AbortController();
    const pending = new GeoClient({ fetch: hanging as unknown as typeof fetch }).geocode({ q: "ab" }, { signal: controller.signal });
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("rejects non-JSON responses", async () => {
    const fetch = vi.fn().mockResolvedValue(new Response("<html>", { status: 502 }));
    await expect(new GeoClient({ fetch }).geocode({ q: "ab" })).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });
});
