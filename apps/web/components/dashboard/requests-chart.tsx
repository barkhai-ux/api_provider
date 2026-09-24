"use client";

import { CircleCheck, CircleX, Table as TableIcon } from "lucide-react";
import { useId, useMemo, useState, type KeyboardEvent } from "react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useElementWidth } from "@/hooks/use-element-width";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { columnPath, formatDay, niceTicks } from "./chart-scale";

export type DailyCounts = { day: string; total: number; successful: number; failed: number };

// Validated with the dataviz palette checker (light on #ffffff, dark on the card surface).
const SUCCESS_FILL = "fill-[#00876d] dark:fill-[#00a699]";
const FAILED_FILL = "fill-[#d01d21] dark:fill-[#ed4a4c]";
const SUCCESS_BG = "bg-[#00876d] dark:bg-[#00a699]";
const FAILED_BG = "bg-[#d01d21] dark:bg-[#ed4a4c]";

const HEIGHT = 220;
const MARGIN = { top: 20, right: 8, bottom: 28, left: 44 };
const MAX_BAR_WIDTH = 24;
const SEGMENT_GAP = 2;
const X_LABEL_COUNT = 5;
// Minimum horizontal room per day label, so labels never overlap on narrow screens.
const X_LABEL_MIN_SPACING = 56;

/**
 * Requests per UTC day as stacked columns (successful below, failed above).
 * Every column is a hover/focus target with a tooltip; a table view carries
 * the same numbers without hovering.
 */
export function RequestsChart({
  data,
  stale = false,
  periodLabel,
}: {
  data: DailyCounts[] | undefined;
  stale?: boolean;
  periodLabel: string;
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const [active, setActive] = useState<number | null>(null);
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const titleId = useId();

  const summary = useMemo(() => {
    if (!data) return null;
    const totals = data.reduce(
      (acc, d) => ({ total: acc.total + d.total, successful: acc.successful + d.successful, failed: acc.failed + d.failed }),
      { total: 0, successful: 0, failed: 0 },
    );
    const peakIndex = data.reduce((best, d, i) => (d.total > (data[best]?.total ?? -1) ? i : best), 0);
    return { ...totals, peakIndex, peak: data[peakIndex] };
  }, [data]);

  if (!data || !summary) {
    return <Skeleton className="h-[260px] w-full" aria-label="Loading chart" />;
  }

  const n = data.length;
  const plotWidth = Math.max(10, width - MARGIN.left - MARGIN.right);
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const ticks = niceTicks(Math.max(...data.map((d) => d.total), 0));
  const yMax = ticks[ticks.length - 1] || 1;
  const band = plotWidth / Math.max(1, n);
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, band * 0.7));
  const y = (value: number) => MARGIN.top + plotHeight - (value / yMax) * plotHeight;
  const baseline = y(0);
  const labelCount = Math.max(2, Math.min(X_LABEL_COUNT, Math.floor(plotWidth / X_LABEL_MIN_SPACING)));
  const labelEvery = Math.max(1, Math.ceil(n / labelCount));
  // The last day is always labelled; drop a regular label that would crowd it.
  const showLabel = (i: number) =>
    i === n - 1 || (i % labelEvery === 0 && (n - 1 - i) * band >= X_LABEL_MIN_SPACING);
  const empty = summary.total === 0;
  const description =
    `Requests per day, ${periodLabel}: ${formatNumber(summary.total)} total, ` +
    `${formatNumber(summary.successful)} successful, ${formatNumber(summary.failed)} failed.` +
    (summary.peak && !empty ? ` Peak ${formatNumber(summary.peak.total)} on ${formatDay(summary.peak.day)}.` : "");

  const tooltipIndex = active ?? focusIndex;
  const tooltipDay = tooltipIndex !== null ? data[tooltipIndex] : undefined;

  function onKeyDown(event: KeyboardEvent<SVGRectElement>, index: number) {
    const next =
      event.key === "ArrowRight" ? Math.min(n - 1, index + 1)
      : event.key === "ArrowLeft" ? Math.max(0, index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? n - 1
      : null;
    if (next === null) return;
    event.preventDefault();
    setFocusIndex(next);
    const svg = event.currentTarget.ownerSVGElement;
    svg?.querySelector<SVGRectElement>(`[data-index="${next}"]`)?.focus();
  }

  return (
    <figure aria-labelledby={titleId} className="space-y-3">
      <figcaption id={titleId} className="sr-only">
        {description}
      </figcaption>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ul className="flex items-center gap-4 text-xs text-muted-foreground" aria-label="Legend">
          <li className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[2px]", SUCCESS_BG)} aria-hidden="true" />
            <CircleCheck className="size-3.5" aria-hidden="true" />
            Successful
          </li>
          <li className="flex items-center gap-1.5">
            <span className={cn("size-2.5 rounded-[2px]", FAILED_BG)} aria-hidden="true" />
            <CircleX className="size-3.5" aria-hidden="true" />
            Failed
          </li>
        </ul>
        <Button variant="ghost" size="sm" onClick={() => setShowTable((v) => !v)} aria-expanded={showTable}>
          <TableIcon aria-hidden="true" />
          {showTable ? "Hide table" : "Show table"}
        </Button>
      </div>

      <div ref={ref} className={cn("relative transition-opacity", stale && "opacity-60")}>
        <svg
          width={width}
          height={HEIGHT}
          viewBox={`0 0 ${width} ${HEIGHT}`}
          role="group"
          aria-label={description}
          className="block max-w-full overflow-visible"
          onPointerLeave={() => setActive(null)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                x1={MARGIN.left}
                x2={width - MARGIN.right}
                y1={y(tick)}
                y2={y(tick)}
                className={tick === 0 ? "stroke-muted-foreground/40" : "stroke-border"}
                strokeWidth={1}
                shapeRendering="crispEdges"
              />
              <text
                x={MARGIN.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-muted-foreground text-[11px] tabular-nums"
              >
                {formatNumber(tick)}
              </text>
            </g>
          ))}

          {data.map((d, i) => {
            const x = MARGIN.left + i * band + (band - barWidth) / 2;
            const successTop = y(d.successful);
            const totalTop = y(d.total);
            const successHeight = baseline - successTop;
            const failedHeight = d.failed > 0 ? successTop - totalTop - (d.successful > 0 ? SEGMENT_GAP : 0) : 0;
            const dimmed = tooltipIndex !== null && tooltipIndex !== i;
            return (
              <g key={d.day} className={cn("transition-opacity", dimmed && "opacity-50")} aria-hidden="true">
                {d.successful > 0 && (
                  <path
                    d={columnPath(x, successTop, barWidth, Math.max(1, successHeight), d.failed > 0 ? 0 : 4)}
                    className={SUCCESS_FILL}
                  />
                )}
                {d.failed > 0 && (
                  <path d={columnPath(x, totalTop, barWidth, Math.max(1, failedHeight), 4)} className={FAILED_FILL} />
                )}
              </g>
            );
          })}

          {summary.peak && !empty && (
            <text
              x={MARGIN.left + summary.peakIndex * band + band / 2}
              y={y(summary.peak.total) - 6}
              textAnchor="middle"
              className="fill-foreground text-[11px] font-medium tabular-nums"
              aria-hidden="true"
            >
              {formatNumber(summary.peak.total)}
            </text>
          )}

          {data.map((d, i) =>
            showLabel(i) ? (
              <text
                key={`label-${d.day}`}
                x={MARGIN.left + i * band + band / 2}
                y={HEIGHT - 8}
                textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                className="fill-muted-foreground text-[11px]"
                aria-hidden="true"
              >
                {formatDay(d.day)}
              </text>
            ) : null,
          )}

          {data.map((d, i) => (
            <rect
              key={`hit-${d.day}`}
              data-index={i}
              x={MARGIN.left + i * band}
              y={MARGIN.top}
              width={band}
              height={plotHeight}
              fill="transparent"
              tabIndex={i === (focusIndex ?? n - 1) ? 0 : -1}
              role="img"
              aria-label={`${formatDay(d.day, true)}: ${formatNumber(d.total)} requests, ${formatNumber(d.successful)} successful, ${formatNumber(d.failed)} failed`}
              className="cursor-default outline-none focus-visible:stroke-ring focus-visible:stroke-2"
              onPointerEnter={() => setActive(i)}
              onFocus={() => setFocusIndex(i)}
              onBlur={() => setFocusIndex(null)}
              onKeyDown={(event) => onKeyDown(event, i)}
            />
          ))}
        </svg>

        {empty && (
          <p className="pointer-events-none absolute inset-x-0 top-1/3 text-center text-sm text-muted-foreground">
            No requests in this period.
          </p>
        )}

        {tooltipDay && tooltipIndex !== null && (
          <div
            role="presentation"
            className="pointer-events-none absolute z-10 min-w-40 -translate-x-1/2 -translate-y-full rounded-md border bg-popover px-3 py-2 text-xs shadow-md"
            style={{
              left: Math.min(Math.max(MARGIN.left + tooltipIndex * band + band / 2, 80), width - 80),
              top: Math.max(y(tooltipDay.total) - 8, 56),
            }}
          >
            <p className="mb-1 text-muted-foreground">{formatDay(tooltipDay.day, true)}</p>
            <p className="mb-1.5 text-sm font-semibold tabular-nums">
              {formatNumber(tooltipDay.total)} <span className="font-normal text-muted-foreground">requests</span>
            </p>
            <p className="flex items-center gap-2">
              <span className={cn("h-0.5 w-3 rounded-full", SUCCESS_BG)} aria-hidden="true" />
              <span className="font-semibold tabular-nums">{formatNumber(tooltipDay.successful)}</span>
              <span className="text-muted-foreground">successful</span>
            </p>
            <p className="flex items-center gap-2">
              <span className={cn("h-0.5 w-3 rounded-full", FAILED_BG)} aria-hidden="true" />
              <span className="font-semibold tabular-nums">{formatNumber(tooltipDay.failed)}</span>
              <span className="text-muted-foreground">failed</span>
            </p>
          </div>
        )}
      </div>

      {showTable && (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <Table>
            <caption className="sr-only">Requests per day, {periodLabel}</caption>
            <TableHeader>
              <TableRow>
                <TableHead>Day (UTC)</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="text-right">Successful</TableHead>
                <TableHead className="text-right">Failed</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {[...data].reverse().map((d) => (
                <TableRow key={d.day}>
                  <TableCell>{formatDay(d.day, true)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.total)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.successful)}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatNumber(d.failed)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </figure>
  );
}
