"use client";

import { Activity, KeyRound, Languages, Route } from "lucide-react";
import { animate, useReducedMotion } from "motion/react";
import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The dark half of the auth pages: what a new account gets, shown as the
 * product itself. A request resolves, the key that made it, and the usage it
 * shows up in. Plays once on load; every value is illustrative.
 */

const REQUESTS_TODAY = 1284;
// Requests per hour for the usage tile, oldest first.
const HOURLY = [18, 26, 22, 34, 30, 46, 41, 58, 52, 70, 64, 88];

const JSON_LINES: { indent?: boolean; key?: string; value?: string; kind?: "string" | "number"; text?: string }[] = [
  { text: "{" },
  { indent: true, key: "name", value: "Сүхбаатарын талбай", kind: "string" },
  { indent: true, key: "address", value: "6-р хороо, Сүхбаатар", kind: "string" },
  { indent: true, key: "latitude", value: "47.91884", kind: "number" },
  { indent: true, key: "longitude", value: "106.91763", kind: "number" },
  { text: "}" },
];

function format(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

/** Delay for a CSS entrance animation, in milliseconds. */
function after(ms: number): CSSProperties {
  return { animationDelay: `${ms}ms` };
}

function Surface({ className, style, children }: { className?: string; style?: CSSProperties; children: ReactNode }) {
  return (
    <div
      style={style}
      className={cn(
        "animate-rise rounded-2xl border border-white/10 bg-card shadow-[0_24px_60px_-24px_rgb(0_0_0/0.8),inset_0_1px_0_rgb(255_255_255/0.05)]",
        className,
      )}
    >
      {children}
    </div>
  );
}

function RequestCard() {
  return (
    <Surface className="overflow-hidden" style={after(0)}>
      <div className="flex items-center gap-2 border-b border-white/[0.06] px-4 py-3">
        <span className="rounded-md bg-primary/15 px-1.5 py-0.5 font-mono text-[11px] font-bold text-primary">GET</span>
        <code className="min-w-0 flex-1 truncate font-mono text-xs text-foreground/90">/v1/geocode?q=Сүхбаатар</code>
        <span
          style={after(650)}
          className="flex shrink-0 animate-pop-in items-center gap-1.5 rounded-full bg-success/10 px-2 py-0.5 font-mono text-[11px] font-semibold text-success"
        >
          <span className="size-1.5 rounded-full bg-success" aria-hidden="true" />
          200 · 38 ms
        </span>
      </div>
      <pre className="px-4 py-3.5 font-mono text-[12px] leading-[1.7]">
        {JSON_LINES.map((line, index) => (
          <span key={index} style={after(750 + index * 55)} className="block animate-fade-up">
            {line.text ?? (
              <>
                {line.indent && "  "}
                <span className="text-muted-foreground">&quot;{line.key}&quot;</span>
                <span className="text-muted-foreground">: </span>
                <span className={line.kind === "number" ? "text-[oklch(0.8_0.13_75)]" : "text-[oklch(0.8_0.12_200)]"}>
                  {line.kind === "string" ? `"${line.value}"` : line.value}
                </span>
                {index < JSON_LINES.length - 2 && <span className="text-muted-foreground">,</span>}
              </>
            )}
          </span>
        ))}
      </pre>
    </Surface>
  );
}

function KeyCard() {
  return (
    <Surface className="w-[250px] p-3.5" style={after(160)}>
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-xs font-semibold text-foreground">
          <span className="grid size-6 place-items-center rounded-md bg-primary/15 text-primary">
            <KeyRound className="size-3.5" aria-hidden="true" />
          </span>
          Production key
        </span>
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-success">
          <span className="relative flex size-1.5">
            <span className="absolute inset-0 animate-ping rounded-full bg-success/60" aria-hidden="true" />
            <span className="relative size-1.5 rounded-full bg-success" aria-hidden="true" />
          </span>
          Active
        </span>
      </div>
      <code className="mt-3 block rounded-lg bg-secondary px-2.5 py-1.5 font-mono text-[11px] tracking-wide text-muted-foreground">
        geo_••••••••••••••••3f9a
      </code>
    </Surface>
  );
}

function UsageCard() {
  const reduced = useReducedMotion();
  const countRef = useRef<HTMLParagraphElement>(null);
  const peak = Math.max(...HOURLY);

  // Count up by writing the text directly: no re-render per frame. The server
  // renders the final value, which is also what reduced motion shows.
  useEffect(() => {
    const node = countRef.current;
    if (!node || reduced) return;
    const controls = animate(0, REQUESTS_TODAY, {
      duration: 1.4,
      delay: 0.55,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (value) => {
        node.textContent = format(value);
      },
    });
    return () => controls.stop();
  }, [reduced]);

  return (
    <Surface className="w-[210px] p-3.5" style={after(300)}>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
        <Activity className="size-3.5" aria-hidden="true" />
        Requests today
      </p>
      <p ref={countRef} className="mt-1 text-2xl font-bold tracking-tight text-foreground tabular-nums">
        {format(REQUESTS_TODAY)}
      </p>
      <div className="mt-2.5 flex h-10 items-end gap-[3px]" aria-hidden="true">
        {HOURLY.map((value, index) => (
          <span
            key={index}
            style={{ height: `${(value / peak) * 100}%`, ...after(600 + index * 35) }}
            className={cn(
              "flex-1 origin-bottom animate-[bar-grow_600ms_var(--ease-out)_both] rounded-[2px]",
              index === HOURLY.length - 1 ? "bg-primary" : "bg-primary/35",
            )}
          />
        ))}
      </div>
    </Surface>
  );
}

const HIGHLIGHTS = [
  { icon: Languages, label: "Latin and Cyrillic search" },
  { icon: Route, label: "Routing with travel times" },
  { icon: Activity, label: "Live usage per key" },
] as const;

export function AuthShowcase() {
  return (
    <div className="relative w-full max-w-[520px]">
      <p className="animate-fade-up text-xs font-bold tracking-[0.16em] text-primary uppercase">Developer console</p>
      <h2 style={after(60)} className="mt-4 animate-fade-up text-4xl leading-[1.1] font-bold text-balance">
        Your first request is a minute away
      </h2>
      <p style={after(120)} className="mt-4 max-w-md animate-fade-up leading-relaxed text-muted-foreground">
        Create a key, send a request, and watch it arrive in your usage dashboard.
      </p>

      {/* Product collage: the usage and key cards overlap the request's empty edges. */}
      <div className="relative mt-12 pb-20" aria-hidden="true">
        <div className="absolute top-[92px] right-[-32px] z-10">
          <UsageCard />
        </div>
        <RequestCard />
        <div className="absolute bottom-0 left-[-28px] z-10">
          <KeyCard />
        </div>
      </div>

      <ul style={after(400)} className="mt-10 flex animate-fade-up flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
        {HIGHLIGHTS.map(({ icon: Icon, label }) => (
          <li key={label} className="flex items-center gap-2">
            <Icon className="size-4 text-foreground/60" aria-hidden="true" />
            {label}
          </li>
        ))}
      </ul>
    </div>
  );
}
