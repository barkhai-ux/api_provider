import type { RouteResponse } from "@geo-platform/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import type { ComponentProps, ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { RoutePanel } from "./route-panel";

const route: RouteResponse = {
  route: {
    distance_meters: 4200,
    duration_seconds: 620,
    geometry: { type: "LineString", coordinates: [[106.9177, 47.9184], [106.9057, 47.922]] },
  },
  mode: "driving",
  waypoints: [],
};

function renderPanel(overrides: Partial<ComponentProps<typeof RoutePanel>> = {}) {
  const props: ComponentProps<typeof RoutePanel> = {
    from: { text: "Sukhbaatar Square", lngLat: [106.9177, 47.9184] },
    to: { text: "State Department Store", lngLat: [106.9057, 47.922] },
    mode: "driving",
    onFromChange: vi.fn(),
    onToChange: vi.fn(),
    onModeChange: vi.fn(),
    onSwap: vi.fn(),
    onUseMyLocation: vi.fn(),
    locating: false,
    onCalculate: vi.fn(),
    onClear: vi.fn(),
    calculating: false,
    result: null,
    error: null,
    ...overrides,
  };
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  render(<RoutePanel {...props} />, { wrapper });
  return props;
}

describe("RoutePanel", () => {
  it("calculates when both points are chosen", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Calculate route" }));
    expect(props.onCalculate).toHaveBeenCalledOnce();
  });

  it("cannot calculate until both points have coordinates", () => {
    renderPanel({ to: { text: "State Dep", lngLat: null } });
    expect(screen.getByRole("button", { name: "Calculate route" })).toBeDisabled();
  });

  it("switches travel mode", () => {
    const props = renderPanel();
    fireEvent.click(screen.getByRole("radio", { name: "Walking" }));
    expect(props.onModeChange).toHaveBeenCalledWith("walking");
    expect(screen.getByRole("radio", { name: "Driving" })).toBeChecked();
  });

  it("shows distance and estimated travel time", () => {
    renderPanel({ result: route });
    expect(screen.getByText("10 min")).toBeInTheDocument();
    expect(screen.getByText("4.2 km")).toBeInTheDocument();
  });

  it("announces errors", () => {
    renderPanel({ error: "No driving route connects the origin and the destination." });
    expect(screen.getByRole("alert")).toHaveTextContent("No driving route connects");
  });

  it("offers swap, current location and clear", () => {
    const props = renderPanel({ result: route });
    fireEvent.click(screen.getByRole("button", { name: "Swap start and destination" }));
    fireEvent.click(screen.getByRole("button", { name: /Use my location/ }));
    fireEvent.click(screen.getByRole("button", { name: "Clear route" }));
    expect(props.onSwap).toHaveBeenCalled();
    expect(props.onUseMyLocation).toHaveBeenCalled();
    expect(props.onClear).toHaveBeenCalled();
  });
});
