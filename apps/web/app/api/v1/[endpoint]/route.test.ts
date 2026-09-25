// @vitest-environment node
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { GET } = await import("./route");

const SITE_KEY = "geo_" + "S".repeat(32);

function call(endpoint: string, query: string, headers: Record<string, string> = {}) {
  const request = new NextRequest(`http://localhost:3000/api/v1/${endpoint}?${query}`, { headers });
  return GET(request, { params: Promise.resolve({ endpoint }) } as never);
}

function upstream(body: string, init: ResponseInit & { headers?: Record<string, string> } = {}) {
  return new Response(body, { status: 200, ...init, headers: { "content-type": "application/json", ...init.headers } });
}

describe("/api/v1 proxy", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubEnv("SITE_API_KEY", SITE_KEY);
    vi.stubEnv("API_INTERNAL_URL", "http://api.internal:8000");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockReset();
    fetchMock.mockImplementation(async () =>
      upstream('{"results":[]}', { headers: { "x-ratelimit-limit": "60", "set-cookie": "a=b", server: "uvicorn" } }),
    );
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("maps each endpoint to one fixed upstream operation with the server-side key", async () => {
    const response = await call("geocode", "q=sukh&limit=5", { cookie: "session=x", authorization: "Bearer attacker" });
    expect(response.status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("http://api.internal:8000/v1/geocode?q=sukh&limit=5");
    expect(init.headers).toEqual({ Accept: "application/json", Authorization: `Bearer ${SITE_KEY}` });
    expect(init.redirect).toBe("error");
    // Only allowlisted response headers reach the browser; never the key.
    expect(response.headers.get("x-ratelimit-limit")).toBe("60");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(response.headers.get("server")).toBeNull();
    expect(await response.text()).not.toContain(SITE_KEY);
  });

  it("refuses anything that is not an allowlisted endpoint", async () => {
    for (const endpoint of ["proxy", "..%2Fadmin", "__proto__", "constructor", "health"]) {
      expect((await call(endpoint, "url=https://evil.example")).status).toBe(404);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects unknown, duplicated, missing and out-of-range parameters before calling the API", async () => {
    const cases: [string, string][] = [
      ["geocode", "q=sukh&url=https://evil.example"],
      ["geocode", "q=sukh&q=zzzz"],
      ["geocode", "limit=5"],
      ["geocode", "q=a"],
      ["geocode", `q=${"x".repeat(201)}`],
      ["geocode", "q=sukh&limit=500"],
      ["geocode", "lat=NaN&lon=106.9"],
      ["geocode", "lat=Infinity&lon=106.9"],
      ["geocode", "lat=91&lon=106.9"],
      ["geocode", "lat=1e309&lon=106.9"],
      ["geocode", "lat=47.9"],
      ["route", "origin=106.9,47.9&destination=106.9,47.9,1"],
      ["route", "origin=181,47.9&destination=106.9,47.9"],
      ["route", "origin=106.9,47.9&destination=106.9,47.9&mode=flying"],
    ];
    for (const [endpoint, query] of cases) {
      const response = await call(endpoint, query);
      expect(response.status, `${endpoint}?${query}`).toBe(400);
      expect((await response.json()).error.code).toBe("INVALID_REQUEST");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("passes through only JSON of bounded size", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<script>alert(1)</script>", { headers: { "content-type": "text/html" } }));
    expect((await call("geocode", "q=sukh")).status).toBe(502);
    fetchMock.mockResolvedValueOnce(upstream("x".repeat(3 * 1024 * 1024)));
    expect((await call("geocode", "q=sukh")).status).toBe(502);
  });

  it("reports timeouts as 504 and hides configuration in errors", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("timed out", "TimeoutError"));
    expect((await call("geocode", "q=sukh")).status).toBe(504);
    vi.stubEnv("SITE_API_KEY", "");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await call("geocode", "q=sukh");
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("SITE_API_KEY");
    error.mockRestore();
  });

  it("forwards the visitor IP only from a trusted header", async () => {
    await call("geocode", "q=sukh", { "x-forwarded-for": "1.2.3.4" });
    expect(fetchMock.mock.calls[0]![1].headers["X-Client-IP"]).toBeUndefined();
    vi.stubEnv("CLIENT_IP_HEADER", "cf-connecting-ip");
    await call("geocode", "q=sukh", { "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "1.2.3.4" });
    expect(fetchMock.mock.calls[1]![1].headers["X-Client-IP"]).toBe("203.0.113.9");
  });
});
