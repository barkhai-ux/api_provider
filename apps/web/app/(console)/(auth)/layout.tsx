import { Check } from "lucide-react";
import { RoutingVisual } from "@/components/developers/feature-visuals";
import { SiteHeader } from "@/components/site/site-header";

const POINTS = [
  "Geocoding, reverse geocoding and routing with one key",
  "Latin and Cyrillic search across Mongolia",
  "Live usage, rate limits and key management",
];

/** Split layout: the form on the left, a product panel on the right (desktop). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="grid flex-1 lg:grid-cols-2">
      <div className="flex items-start justify-center px-4 py-12 sm:items-center sm:py-16">{children}</div>
      <aside className="theme-dark relative hidden overflow-hidden border-l bg-background text-foreground lg:flex lg:flex-col lg:justify-center lg:px-14 xl:px-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_50%_at_60%_30%,var(--glow),transparent_70%)]"
        />
        <div className="relative max-w-lg">
          <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">Ubhub Location Service</p>
          <h2 className="mt-4 text-4xl leading-[1.1] font-bold">Location APIs for Mongolia</h2>
          <ul className="mt-8 flex flex-col gap-3">
            {POINTS.map((point) => (
              <li key={point} className="flex items-start gap-3 text-muted-foreground">
                <Check className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                {point}
              </li>
            ))}
          </ul>
          <div className="mt-12">
            <RoutingVisual />
          </div>
        </div>
      </aside>
      </main>
    </>
  );
}
