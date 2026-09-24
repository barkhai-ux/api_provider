import { formatNumber } from "@/lib/format";

const compact = new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 });

/** Stat-tile values: full digits up to 99,999, then 128.4K / 4.2M. */
export function formatStat(value: number): string {
  return Math.abs(value) < 100_000 ? formatNumber(value) : compact.format(value);
}

export function formatPercent(part: number, total: number): string {
  if (total === 0) return "—";
  const percent = (part / total) * 100;
  return `${percent >= 99.95 || percent === 0 ? percent.toFixed(0) : percent.toFixed(1)}%`;
}

export function formatLatency(ms: number): string {
  return `${formatNumber(Math.round(ms))} ms`;
}
