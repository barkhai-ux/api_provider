import Link from "next/link";
import { Logo } from "./logo";

const COLUMNS = [
  {
    title: "APIs",
    links: [
      { href: "/developers/docs/geocoding", label: "Geocoding" },
      { href: "/developers/docs/reverse-geocoding", label: "Reverse geocoding" },
      { href: "/developers/docs/routing", label: "Routing" },
      { href: "/", label: "Map" },
    ],
  },
  {
    title: "Developers",
    links: [
      { href: "/developers/docs/getting-started", label: "Getting started" },
      { href: "/developers/docs", label: "Documentation" },
      { href: "/developers/api-reference", label: "API reference" },
      { href: "/developers/docs/examples", label: "Code examples" },
    ],
  },
  {
    title: "Reference",
    links: [
      { href: "/developers/docs/authentication", label: "Authentication" },
      { href: "/developers/docs/errors", label: "Errors" },
      { href: "/developers/docs/rate-limits", label: "Rate limits" },
      { href: "/developers/docs/versioning", label: "Versioning" },
    ],
  },
  {
    title: "Account",
    links: [
      { href: "/register", label: "Get an API key" },
      { href: "/login", label: "Sign in" },
      { href: "/dashboard", label: "Dashboard" },
      { href: "/dashboard/usage", label: "Usage" },
    ],
  },
] as const;

export function SiteFooter() {
  return (
    <footer className="theme-dark border-t bg-background text-foreground">
      <div className="mx-auto grid max-w-[1400px] gap-12 px-4 py-16 sm:px-6 lg:grid-cols-[1.2fr_2fr] lg:px-8">
        <div className="flex flex-col gap-4">
          <Logo />
          <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
            Geocoding, reverse geocoding and routing APIs for Mongolia.
          </p>
        </div>
        <nav aria-label="Footer" className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {COLUMNS.map((column) => (
            <div key={column.title}>
              <h2 className="text-xs font-bold tracking-[0.12em] text-foreground uppercase">{column.title}</h2>
              <ul className="mt-4 flex flex-col gap-3">
                {column.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-muted-foreground transition-colors hover:text-foreground">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-[1400px] flex-col gap-2 px-4 py-6 text-xs text-muted-foreground sm:flex-row sm:justify-between sm:px-6 lg:px-8">
          <span>© {new Date().getFullYear()} Geo Platform</span>
          <span>Basemap © Esri and contributors · Data from the platform&apos;s ArcGIS services</span>
        </div>
      </div>
    </footer>
  );
}
