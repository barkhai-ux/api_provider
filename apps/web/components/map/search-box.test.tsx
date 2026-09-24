import { GeoApiError } from "@geo-platform/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SEARCH_DEBOUNCE_MS } from "@/hooks/use-geocode-search";
import { siteGeoClient } from "@/lib/geo";
import { SearchBox } from "./search-box";

const results = [
  { id: "plc_1", name: "Sukhbaatar Square", address: "Ulaanbaatar, Mongolia", latitude: 47.9189, longitude: 106.9176, type: "landmark" },
  { id: "plc_2", name: "Sukhbaatar District", address: "Ulaanbaatar, Mongolia", latitude: 47.93, longitude: 106.92, type: "district" },
];

function renderSearch(onSelect = vi.fn()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Harness() {
    const [text, setText] = useState("");
    return <SearchBox label="Search location" text={text} onTextChange={setText} onSelect={onSelect} />;
  }
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<Harness />, { wrapper });
  return { input: screen.getByRole("combobox", { name: "Search location" }), onSelect };
}

async function typeAndWait(input: HTMLElement, value: string) {
  fireEvent.focus(input);
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 10);
  });
}

describe("SearchBox", () => {
  let geocode: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    geocode = vi.spyOn(siteGeoClient, "geocode").mockResolvedValue({ query: "sukh", results, count: 2 });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("debounces typing into a single API request", async () => {
    const { input } = renderSearch();
    fireEvent.focus(input);
    for (const value of ["s", "su", "suk", "sukh"]) {
      fireEvent.change(input, { target: { value } });
      await act(async () => {
        await vi.advanceTimersByTimeAsync(50);
      });
    }
    expect(geocode).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS);
    });
    expect(geocode).toHaveBeenCalledTimes(1);
    expect(geocode.mock.calls[0][0]).toEqual({ q: "sukh", limit: 6 });
    expect(geocode.mock.calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("does not search for fewer than two characters", async () => {
    const { input } = renderSearch();
    await typeAndWait(input, "s");
    expect(geocode).not.toHaveBeenCalled();
  });

  it("shows results and selects one with the keyboard", async () => {
    const { input, onSelect } = renderSearch();
    await typeAndWait(input, "sukh");
    expect(await screen.findByRole("option", { name: /Sukhbaatar Square/ })).toBeInTheDocument();
    expect(input).toHaveAttribute("aria-expanded", "true");

    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("option", { name: /Sukhbaatar District/ })).toHaveAttribute("aria-selected", "true");
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSelect).toHaveBeenCalledWith(results[1]);
    expect(input).toHaveValue("Sukhbaatar District");
    expect(input).toHaveAttribute("aria-expanded", "false");
  });

  it("selects a result with the mouse", async () => {
    const { input, onSelect } = renderSearch();
    await typeAndWait(input, "sukh");
    fireEvent.click(await screen.findByRole("option", { name: /Sukhbaatar Square/ }));
    expect(onSelect).toHaveBeenCalledWith(results[0]);
  });

  it("tells the user when nothing matched", async () => {
    geocode.mockResolvedValue({ query: "zzz", results: [], count: 0 });
    const { input } = renderSearch();
    await typeAndWait(input, "zzz");
    expect(await screen.findByText("No places found.")).toBeInTheDocument();
  });

  it("shows API errors", async () => {
    geocode.mockRejectedValue(new GeoApiError({ status: 503, code: "SERVICE_UNAVAILABLE", message: "down" }));
    const { input } = renderSearch();
    await typeAndWait(input, "sukh");
    expect(await screen.findByText("Search is temporarily unavailable.")).toBeInTheDocument();
  });

  it("aborts the previous request when the query changes", async () => {
    const signals: AbortSignal[] = [];
    geocode.mockImplementation((_params: unknown, options?: { signal?: AbortSignal }) => {
      if (options?.signal) signals.push(options.signal);
      return new Promise(() => {});
    });
    const { input } = renderSearch();
    await typeAndWait(input, "sukh");
    await typeAndWait(input, "sukhbaatar");
    expect(signals).toHaveLength(2);
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it("closes on Escape", async () => {
    const { input } = renderSearch();
    await typeAndWait(input, "sukh");
    await screen.findByRole("option", { name: /Sukhbaatar Square/ });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(input).toHaveAttribute("aria-expanded", "false");
  });
});
