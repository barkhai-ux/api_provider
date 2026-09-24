/** Round axis ticks: 0 and multiples of 1, 2 or 5 × 10^n, covering `max`. */
export function niceTicks(max: number, targetCount = 4): number[] {
  if (!(max > 0)) return [0, 1, 2, 3, 4];
  const rough = max / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * magnitude).find((s) => s >= rough) ?? 10 * magnitude;
  const niceStep = Math.max(1, step);
  const top = Math.ceil(max / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let value = 0; value <= top + niceStep / 2; value += niceStep) ticks.push(value);
  return ticks;
}

/** Column with a rounded data end (top) and a square base. */
export function columnPath(x: number, y: number, width: number, height: number, radius = 4): string {
  if (height <= 0 || width <= 0) return "";
  const r = Math.min(radius, width / 2, height);
  const bottom = y + height;
  return [
    `M${x},${bottom}`,
    `V${y + r}`,
    `Q${x},${y} ${x + r},${y}`,
    `H${x + width - r}`,
    `Q${x + width},${y} ${x + width},${y + r}`,
    `V${bottom}`,
    "Z",
  ].join(" ");
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
const longDayFormat = new Intl.DateTimeFormat("en-US", {
  weekday: "short",
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

/** Usage days are UTC calendar days ("YYYY-MM-DD"). */
export function formatDay(day: string, long = false): string {
  const date = new Date(`${day}T00:00:00Z`);
  return (long ? longDayFormat : dayFormat).format(date);
}
