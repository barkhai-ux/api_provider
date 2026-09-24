import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { publicConfig } from "@/lib/config";
import { Playground } from "./playground";

vi.mock("next/navigation", () => ({ usePathname: () => "/developers/api-reference" }));

const API_KEY = "geo_abcdefghijklmnopqrstuvwxyz123456";
const PLAYGROUND_TOKEN = `geo_pt_${"x".repeat(40)}`;

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

const geocodeBody = {
  query: "Gandan",
  results: [{ id: "plc_8", name: "Gandan Monastery", address: null, latitude: 47.92, longitude: 106.89, type: "landmark" }],
  count: 1,
};

describe("Playground", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the request line and a cURL command without a real key", async () => {
    fetchMock.mockResolvedValue(json({ error: { code: "AUTHENTICATION_REQUIRED" } }, { status: 401 }));
    render(<Playground endpoint="geocode" />, { wrapper });
    expect(screen.getByTestId("request-line")).toHaveTextContent("/v1/geocode?q=Sukhbaatar%20Square&limit=5");
    expect(screen.getByTestId("curl")).toHaveTextContent(
      `curl "${publicConfig.apiUrl}/v1/geocode?q=Sukhbaatar%20Square&limit=5"`,
    );
    expect(screen.getByTestId("curl")).toHaveTextContent("Bearer YOUR_API_KEY");
    expect(await screen.findByRole("link", { name: "Sign in to use your keys" })).toHaveAttribute(
      "href",
      "/login?next=%2Fdevelopers%2Fapi-reference",
    );
  });

  it("sends a pasted key and shows status, rate limit and JSON", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/playground/keys") return json({ error: {} }, { status: 401 });
      return json(geocodeBody, {
        headers: { "X-RateLimit-Limit": "100", "X-RateLimit-Remaining": "99", "X-RateLimit-Reset": "1790230080" },
      });
    });
    render(<Playground endpoint="geocode" />, { wrapper });

    await user.click(screen.getByLabelText("Paste a key"));
    await user.type(screen.getByLabelText("API key"), API_KEY);
    const q = screen.getByLabelText(/^q/);
    await user.clear(q);
    await user.type(q, "Gandan");
    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByTestId("status-line")).toHaveTextContent("200 OK");
    expect(screen.getByTestId("response-body")).toHaveTextContent('"name": "Gandan Monastery"');
    expect(screen.getByText("99/100 left")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls.find(([called]) => String(called).startsWith(publicConfig.apiUrl))!;
    expect(url).toBe(`${publicConfig.apiUrl}/v1/geocode?q=Gandan&limit=5`);
    expect((init as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${API_KEY}` });
    expect(screen.getByTestId("curl")).not.toHaveTextContent(API_KEY);
  });

  it("uses a playground token for a connected key", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/playground/keys") {
        return json({ keys: [{ id: "key_1", name: "Backend", maskedKey: "geo_ab12••••", endpoints: ["geocode", "reverse-geocode", "route"] }] });
      }
      if (url === "/api/playground/token") {
        expect(JSON.parse(String(init?.body))).toEqual({ keyId: "key_1" });
        return json({ token: PLAYGROUND_TOKEN, expiresAt: Date.now() + 15 * 60_000 });
      }
      return json({ error: { code: "NOT_FOUND", message: "No address or place was found near this location." } }, { status: 404 });
    });
    render(<Playground endpoint="reverse-geocode" />, { wrapper });

    expect(await screen.findByRole("option", { name: /Backend/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /send request/i }));

    expect(await screen.findByTestId("status-line")).toHaveTextContent("404 Not Found");
    const apiCall = fetchMock.mock.calls.find(([called]) => String(called).startsWith(publicConfig.apiUrl))!;
    expect(apiCall[0]).toBe(`${publicConfig.apiUrl}/v1/reverse-geocode?lat=47.9184&lon=106.9177`);
    expect((apiCall[1] as RequestInit).headers).toMatchObject({ Authorization: `Bearer ${PLAYGROUND_TOKEN}` });
  });

  it("validates parameters before sending", async () => {
    const user = userEvent.setup();
    fetchMock.mockResolvedValue(json({ error: {} }, { status: 401 }));
    render(<Playground endpoint="geocode" />, { wrapper });
    await user.click(screen.getByLabelText("Paste a key"));
    await user.type(screen.getByLabelText("API key"), API_KEY);
    await user.clear(screen.getByLabelText(/^q/));
    await user.type(screen.getByLabelText(/^q/), "a");
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(await screen.findByText("At least 2 characters.")).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([called]) => String(called).startsWith(publicConfig.apiUrl))).toBe(false),
    );
  });

  it("explains network failures", async () => {
    const user = userEvent.setup();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/playground/keys") return json({ error: {} }, { status: 401 });
      throw new TypeError("Failed to fetch");
    });
    render(<Playground endpoint="route" />, { wrapper });
    await user.click(screen.getByLabelText("Paste a key"));
    await user.type(screen.getByLabelText("API key"), API_KEY);
    await user.click(screen.getByRole("button", { name: /send request/i }));
    expect(await screen.findByRole("alert")).toHaveTextContent(`Could not reach ${publicConfig.apiUrl}`);
  });
});
