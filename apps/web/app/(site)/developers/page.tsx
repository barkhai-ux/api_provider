import { ArrowRight, Braces, Gauge, KeyRound, ShieldCheck } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { GeocodingVisual, ReverseGeocodingVisual, RoutingVisual } from "@/components/developers/feature-visuals";
import { HeroShowcase } from "@/components/developers/hero-showcase";
import { LiveDemo } from "@/components/developers/live-demo";
import { CodeTabs } from "@/components/docs/code-block";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { publicConfig } from "@/lib/config";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Developers",
  description: "Geocoding, reverse geocoding and routing APIs for Mongolia.",
};

const apiUrl = publicConfig.apiUrl;

const EXAMPLES = [
  {
    label: "TypeScript",
    lang: "typescript" as const,
    code: `type RouteResponse = {
  route: { distance_meters: number; duration_seconds: number };
};

const params = new URLSearchParams({
  origin: "106.9177,47.9184",
  destination: "106.9057,47.9220",
  mode: "driving",
});

const response = await fetch(\`${apiUrl}/v1/route?\${params}\`, {
  headers: { Authorization: \`Bearer \${process.env.GEO_API_KEY}\` },
});
const { route } = (await response.json()) as RouteResponse;
console.log(route.distance_meters, route.duration_seconds);`,
  },
  {
    label: "cURL",
    lang: "bash" as const,
    code: `curl "${apiUrl}/v1/geocode?q=Ulaanbaatar" \\
  -H "Authorization: Bearer YOUR_API_KEY"`,
  },
  {
    label: "Python",
    lang: "python" as const,
    code: `import os
import httpx

response = httpx.get(
    "${apiUrl}/v1/geocode",
    params={"lat": 47.9184, "lon": 106.9177},
    headers={"Authorization": f"Bearer {os.environ['GEO_API_KEY']}"},
)
print(response.json()["results"][0]["address"])`,
  },
];

const ENDPOINTS = [
  { label: "Geocoding", endpoint: "/v1/geocode", body: "Place names and addresses to coordinates, and coordinates back to the nearest place." },
  { label: "Routing", endpoint: "/v1/route", body: "Routes, distances and travel times." },
] as const;

const PLATFORM = [
  { icon: KeyRound, title: "API keys", body: "Create, rename, rotate and revoke keys. Secrets are hashed and shown once." },
  { icon: Gauge, title: "Live usage", body: "Requests, errors and latency per key, updated as they happen." },
  { icon: Braces, title: "OpenAPI schema", body: "A versioned /v1 contract, described by an OpenAPI schema. Plain HTTPS and JSON." },
  { icon: ShieldCheck, title: "Predictable errors", body: "One error envelope with stable codes and rate-limit headers." },
] as const;

function Eyebrow({ children }: { children: ReactNode }) {
  return <p className="text-xs font-bold tracking-[0.16em] text-primary uppercase">{children}</p>;
}

function TextLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="group inline-flex items-center gap-1.5 text-[15px] font-bold text-primary">
      {children}
      <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
    </Link>
  );
}

function Feature({
  eyebrow,
  title,
  body,
  link,
  visual,
  reverse = false,
}: {
  eyebrow: string;
  title: string;
  body: string;
  link: { href: string; label: string };
  visual: ReactNode;
  reverse?: boolean;
}) {
  return (
    <div className="grid items-center gap-10 py-16 lg:grid-cols-2 lg:gap-20 lg:py-24">
      <div className={cn("max-w-xl", reverse && "lg:order-2")}>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h3 className="mt-4 text-3xl leading-[1.1] font-bold text-foreground sm:text-[44px]">{title}</h3>
        <p className="mt-5 text-lg leading-relaxed text-muted-foreground">{body}</p>
        <div className="mt-7">
          <TextLink href={link.href}>{link.label}</TextLink>
        </div>
      </div>
      <div className={cn(reverse && "lg:order-1")}>{visual}</div>
    </div>
  );
}

export default async function DevelopersPage() {
  const t = await getT();
  return (
    <div className="theme-dark overflow-x-clip bg-background text-foreground">
      <Link
        href="/developers/docs/getting-started"
        className="group flex items-center justify-center gap-2 bg-[linear-gradient(90deg,oklch(0.3_0.12_265),oklch(0.42_0.17_262),oklch(0.3_0.12_265))] px-4 py-2.5 text-center text-sm font-semibold text-white"
      >
        Public API v1 is live: geocoding, reverse geocoding and routing
        <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      {/* Hero */}
      <section className="mx-auto max-w-[1400px] px-4 pt-20 pb-16 sm:px-6 lg:px-8 lg:pt-28">
        <div className="mx-auto flex max-w-4xl flex-col items-center text-center">
          <span className="rounded-sm bg-primary px-2 py-1 text-[11px] font-bold tracking-[0.14em] text-primary-foreground uppercase">
            {t("developers.hero.badge")}
          </span>
          <h1 className="mt-6 text-[44px] leading-[1.04] font-bold text-foreground sm:text-6xl lg:text-[72px]">
            {t("developers.hero.title")}
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
            {t("developers.hero.subtitle")}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Button asChild size="xl">
              <Link href="/register">{t("developers.hero.getStarted")}</Link>
            </Button>
            <Button asChild size="xl" variant="contrast">
              <Link href="/developers/docs">{t("developers.hero.readDocs")}</Link>
            </Button>
          </div>
        </div>
        <div className="mt-20">
          <HeroShowcase />
        </div>
      </section>

      {/* Endpoint band */}
      <section aria-label="Endpoints" className="border-y">
        <div className="mx-auto grid max-w-[1400px] sm:grid-cols-2">
          {ENDPOINTS.map((item, index) => (
            <div
              key={item.endpoint}
              className={cn("px-6 py-8 lg:px-8", index > 0 && "border-t sm:border-t-0 sm:border-l")}
            >
              <p className="font-mono text-xs text-primary">GET {item.endpoint}</p>
              <p className="mt-2 text-lg font-bold text-foreground">{item.label}</p>
              <p className="mt-1 text-sm text-muted-foreground">{item.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Features */}
      <section aria-labelledby="features-heading" className="mx-auto max-w-[1400px] px-4 pt-24 sm:px-6 lg:px-8">
        <div className="max-w-3xl">
          <h2 id="features-heading" className="text-4xl leading-[1.08] font-bold sm:text-[52px]">
            Everything location, behind one API
          </h2>
          <p className="mt-5 text-lg text-muted-foreground">
            The same endpoints power the map on this site. What you see is what your application gets.
          </p>
        </div>
        <div className="divide-y">
          <Feature
            eyebrow="Geocoding"
            title="Find any place, in Latin or Cyrillic"
            body="Type as little as two letters. Results are ranked as you type and come back with coordinates, an address and a category."
            link={{ href: "/developers/docs/geocoding", label: "Geocoding API" }}
            visual={<GeocodingVisual />}
          />
          <Feature
            reverse
            eyebrow="Reverse geocoding"
            title="Turn a tap on the map into an address"
            body="Send a latitude and longitude, get the nearest address, place or street with its khoroo and district, and how far away it is."
            link={{ href: "/developers/docs/geocoding", label: "Geocoding API" }}
            visual={<ReverseGeocodingVisual />}
          />
          <Feature
            eyebrow="Routing"
            title="Routes, distances and travel times"
            body="Routes as GeoJSON, with the distance and estimated travel time you need for ETAs and delivery planning."
            link={{ href: "/developers/docs/routing", label: "Routing API" }}
            visual={<RoutingVisual />}
          />
        </div>
      </section>

      {/* Developers */}
      <section aria-labelledby="developers-heading" className="border-t bg-card/40">
        <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-24 sm:px-6 lg:grid-cols-[5fr_7fr] lg:items-center lg:gap-20 lg:px-8">
          <div>
            <Eyebrow>For developers</Eyebrow>
            <h2 id="developers-heading" className="mt-4 text-4xl leading-[1.08] font-bold sm:text-[52px]">
              From API key to first request in minutes
            </h2>
            <dl className="mt-10 grid gap-8 sm:grid-cols-2">
              {PLATFORM.map(({ icon: Icon, title, body }) => (
                <div key={title}>
                  <dt className="flex items-center gap-2.5 font-bold text-foreground">
                    <Icon className="size-5 text-primary" aria-hidden="true" />
                    {title}
                  </dt>
                  <dd className="mt-2 text-sm leading-relaxed text-muted-foreground">{body}</dd>
                </div>
              ))}
            </dl>
            <div className="mt-10">
              <TextLink href="/developers/docs/getting-started">Getting started guide</TextLink>
            </div>
          </div>
          <div className="min-w-0">
            <CodeTabs examples={EXAMPLES} className="my-0 rounded-2xl bg-code shadow-2xl" />
          </div>
        </div>
      </section>

      {/* Live demo */}
      <section aria-labelledby="demo-heading" className="border-t">
        <div className="mx-auto max-w-[1400px] px-4 py-24 sm:px-6 lg:px-8">
          <div className="max-w-2xl">
            <Eyebrow>Live</Eyebrow>
            <h2 id="demo-heading" className="mt-4 text-4xl leading-[1.08] font-bold sm:text-[52px]">
              Try every endpoint
            </h2>
            <p className="mt-5 text-lg text-muted-foreground">
              Real requests against the live API, made by this site on your behalf. No key needed here.
            </p>
          </div>
          <div className="mt-12 rounded-2xl border bg-card p-4 sm:p-6">
            <LiveDemo />
          </div>
        </div>
      </section>

      {/* Call to action */}
      <section className="relative overflow-hidden border-t">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_80%_at_50%_100%,var(--glow),transparent_70%)]"
        />
        <div className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-28 text-center">
          <h2 className="text-4xl leading-[1.05] font-bold sm:text-[56px]">{t("developers.cta.title")}</h2>
          <p className="mt-5 text-lg text-muted-foreground">
            {t("developers.cta.subtitle")}
          </p>
          <div className="mt-10 flex flex-wrap justify-center gap-4">
            <Button asChild size="xl">
              <Link href="/register">{t("developers.hero.getStarted")}</Link>
            </Button>
            <Button asChild size="xl" variant="contrast">
              <Link href="/developers/api-reference">{t("developers.cta.apiReference")}</Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
