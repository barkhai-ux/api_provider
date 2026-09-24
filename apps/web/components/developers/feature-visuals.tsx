import { Car, Footprints, MapPin, Search } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * Illustrations for the developer landing page: product UI cards over a
 * stylized street canvas. Place names are real results from the platform's
 * geocoder; the street canvas is decorative.
 */

const MINOR_STREETS = [
  "M0 70 L640 40",
  "M0 150 L640 128",
  "M0 330 L640 318",
  "M0 410 L640 402",
  "M60 0 L90 460",
  "M170 0 L185 460",
  "M300 0 L292 460",
  "M430 0 L440 460",
  "M560 0 L548 460",
  "M0 250 C120 230 200 290 330 260 S520 220 640 250",
];
const MAJOR_ROADS = ["M0 225 L640 196", "M235 0 L250 460", "M0 460 L420 0"];

function MapCanvas({ children, className }: { children?: ReactNode; className?: string }) {
  return (
    <div
      className={cn(
        "relative aspect-[640/460] w-full overflow-hidden rounded-2xl border bg-[oklch(0.19_0.008_260)]",
        className,
      )}
    >
      <svg viewBox="0 0 640 460" className="absolute inset-0 size-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <path d="M-20 360 C120 330 180 400 300 380 S520 320 660 350" stroke="oklch(0.45 0.12 250 / 0.35)" strokeWidth="26" fill="none" />
        <rect x="330" y="60" width="90" height="60" rx="6" fill="oklch(0.42 0.06 150 / 0.25)" />
        <rect x="95" y="280" width="70" height="40" rx="6" fill="oklch(0.42 0.06 150 / 0.2)" />
        {MINOR_STREETS.map((d) => (
          <path key={d} d={d} stroke="oklch(1 0 0 / 0.07)" strokeWidth="7" fill="none" strokeLinecap="round" />
        ))}
        {MAJOR_ROADS.map((d) => (
          <path key={d} d={d} stroke="oklch(1 0 0 / 0.14)" strokeWidth="12" fill="none" strokeLinecap="round" />
        ))}
      </svg>
      {children}
    </div>
  );
}

function Pin({ x, y, active = false }: { x: number; y: number; active?: boolean }) {
  return (
    <span
      className="absolute -translate-x-1/2 -translate-y-full"
      style={{ left: `${(x / 640) * 100}%`, top: `${(y / 460) * 100}%` }}
      aria-hidden="true"
    >
      <svg viewBox="0 0 28 36" className={cn("drop-shadow-lg", active ? "h-9 w-7" : "h-7 w-5 opacity-80")}>
        <path
          d="M14 1C7 1 1.5 6.5 1.5 13.3 1.5 22.6 14 35 14 35s12.5-12.4 12.5-21.7C26.5 6.5 21 1 14 1Z"
          fill={active ? "#2f6bff" : "#5b6474"}
          stroke="#fff"
          strokeWidth="2"
        />
        <circle cx="14" cy="13.5" r="4.5" fill="#fff" />
      </svg>
    </span>
  );
}

const RESULTS = [
  { name: "Sukhbaatar District", address: "7-р хороо, Сүхбаатар", x: 372, y: 150 },
  { name: "Sukhbaatar District General Hospital", address: "11-р хороо, Сүхбаатар", x: 420, y: 118 },
  { name: "Сүхбаатар дүүргийн нийгмийн даатгал", address: "6-р хороо, Чингэлтэй", x: 262, y: 176 },
];

export function GeocodingVisual() {
  return (
    <MapCanvas>
      {RESULTS.map((r, i) => (
        <Pin key={r.name} x={r.x} y={r.y} active={i === 0} />
      ))}
      <div className="absolute top-[6%] left-[5%] w-[62%] min-w-56 rounded-2xl border bg-background/95 p-3 shadow-2xl backdrop-blur">
        <div className="flex items-center gap-2 rounded-xl border bg-secondary px-3 py-2 text-sm text-foreground">
          <Search className="size-4 text-muted-foreground" aria-hidden="true" />
          sukh
          <span className="ml-0.5 h-4 w-px animate-pulse bg-primary" aria-hidden="true" />
        </div>
        <ul className="mt-2 flex flex-col">
          {RESULTS.map((r, i) => (
            <li key={r.name} className={cn("flex items-start gap-2.5 rounded-lg px-2 py-1.5", i === 0 && "bg-accent")}>
              <MapPin className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold text-foreground">{r.name}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{r.address}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </MapCanvas>
  );
}

export function ReverseGeocodingVisual() {
  return (
    <MapCanvas>
      <span
        className="absolute size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/50 bg-primary/10"
        style={{ left: "50%", top: "46%" }}
        aria-hidden="true"
      />
      <Pin x={320} y={212} active />
      <div className="absolute right-[5%] bottom-[7%] left-[5%] rounded-2xl border bg-background/95 p-4 shadow-2xl backdrop-blur sm:left-auto sm:w-[70%]">
        <div className="flex items-center justify-between gap-2">
          <span className="rounded-md bg-primary/15 px-2 py-0.5 text-[11px] font-bold tracking-wider text-primary uppercase">
            place
          </span>
          <span className="font-mono text-[11px] text-muted-foreground">47.91840, 106.91770 · 49 m</span>
        </div>
        <p className="mt-2.5 text-base font-bold text-foreground">Сүхбаатарын талбай</p>
        <p className="text-sm text-muted-foreground">6-р хороо, Сүхбаатар, Mongolia</p>
      </div>
    </MapCanvas>
  );
}

export function RoutingVisual() {
  return (
    <MapCanvas>
      <svg viewBox="0 0 640 460" className="absolute inset-0 size-full" aria-hidden="true" preserveAspectRatio="xMidYMid slice">
        <path
          d="M118 360 L108 250 L243 232 L239 128 L430 102 L436 70"
          stroke="#2f6bff"
          strokeOpacity="0.35"
          strokeWidth="16"
          fill="none"
          strokeLinejoin="round"
        />
        <path
          d="M118 360 L108 250 L243 232 L239 128 L430 102 L436 70"
          stroke="#2f6bff"
          strokeWidth="6"
          fill="none"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        <circle cx="118" cy="360" r="9" fill="#fff" stroke="#2f6bff" strokeWidth="4" />
      </svg>
      <Pin x={436} y={72} active />
      <div className="absolute top-[6%] right-[5%] w-[52%] min-w-52 rounded-2xl border bg-background/95 p-3.5 shadow-2xl backdrop-blur">
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-secondary p-1 text-xs font-semibold">
          <span className="flex items-center justify-center gap-1.5 rounded-md bg-background py-1.5 text-foreground">
            <Car className="size-3.5" aria-hidden="true" /> Driving
          </span>
          <span className="flex items-center justify-center gap-1.5 py-1.5 text-muted-foreground">
            <Footprints className="size-3.5" aria-hidden="true" /> Walking
          </span>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-3xl font-bold tracking-tight text-foreground">10 min</span>
          <span className="text-sm text-muted-foreground">4.2 km</span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">Fastest route for the selected travel mode</p>
      </div>
    </MapCanvas>
  );
}
