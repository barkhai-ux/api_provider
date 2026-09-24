import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { niceTicks } from "./chart-scale";
import { RequestsChart } from "./requests-chart";

const data = [
  { day: "2026-09-22", total: 10, successful: 9, failed: 1 },
  { day: "2026-09-23", total: 0, successful: 0, failed: 0 },
  { day: "2026-09-24", total: 42, successful: 40, failed: 2 },
];

describe("RequestsChart", () => {
  it("summarizes the data for screen readers and labels every day", () => {
    render(<RequestsChart data={data} periodLabel="last 3 days" />);
    expect(
      screen.getByRole("group", {
        name: "Requests per day, last 3 days: 52 total, 49 successful, 3 failed. Peak 42 on Sep 24.",
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole("img", { name: /Thu, Sep 24, 2026: 42 requests, 40 successful, 2 failed/ })).toBeInTheDocument();
  });

  it("offers a table view with the same numbers", async () => {
    const user = userEvent.setup();
    render(<RequestsChart data={data} periodLabel="last 3 days" />);
    await user.click(screen.getByRole("button", { name: "Show table" }));
    expect(screen.getByRole("table", { name: "Requests per day, last 3 days" })).toBeInTheDocument();
    expect(screen.getAllByRole("row")).toHaveLength(4);
  });

  it("uses round axis ticks", () => {
    expect(niceTicks(42)).toEqual([0, 20, 40, 60]);
    expect(niceTicks(0)).toEqual([0, 1, 2, 3, 4]);
    expect(niceTicks(1284)).toEqual([0, 500, 1000, 1500]);
  });
});
