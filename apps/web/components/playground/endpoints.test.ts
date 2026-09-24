import { describe, expect, it } from "vitest";
import { PLAYGROUND_ENDPOINTS, buildCurl, buildRequestPath, defaultValues, statusLine } from "./endpoints";

describe("playground request building", () => {
  it("encodes the query with %20 and keeps parameter order", () => {
    const endpoint = PLAYGROUND_ENDPOINTS.geocode;
    expect(buildRequestPath(endpoint, defaultValues(endpoint))).toBe("/v1/geocode?q=Sukhbaatar%20Square&limit=5");
  });

  it("omits empty optional parameters", () => {
    const endpoint = PLAYGROUND_ENDPOINTS.geocode;
    expect(buildRequestPath(endpoint, { q: "Сүхбаатар", limit: "" })).toBe(
      `/v1/geocode?q=${encodeURIComponent("Сүхбаатар")}`,
    );
  });

  it("removes spaces from coordinates", () => {
    const endpoint = PLAYGROUND_ENDPOINTS.route;
    expect(
      buildRequestPath(endpoint, { origin: "106.9177, 47.9184", destination: "106.9057,47.9220", mode: "walking" }),
    ).toBe("/v1/route?origin=106.9177%2C47.9184&destination=106.9057%2C47.9220&mode=walking");
  });

  it("never puts a credential in the cURL command", () => {
    expect(buildCurl("https://api.example.com", "/v1/geocode?q=a")).toBe(
      'curl "https://api.example.com/v1/geocode?q=a" \\\n  -H "Authorization: Bearer YOUR_API_KEY"',
    );
  });

  it("validates like the API", () => {
    expect(PLAYGROUND_ENDPOINTS.geocode.schema.safeParse({ q: "a", limit: "5" }).success).toBe(false);
    expect(PLAYGROUND_ENDPOINTS.geocode.schema.safeParse({ q: "ab", limit: "21" }).success).toBe(false);
    expect(PLAYGROUND_ENDPOINTS["reverse-geocode"].schema.safeParse({ lat: "95", lon: "106" }).success).toBe(false);
    expect(
      PLAYGROUND_ENDPOINTS.route.schema.safeParse({ origin: "47.9,106.9", destination: "106.9,47.9", mode: "driving" })
        .success,
    ).toBe(false);
  });

  it("formats status lines", () => {
    expect(statusLine(200)).toBe("200 OK");
    expect(statusLine(429, "")).toBe("429 Too Many Requests");
  });
});
