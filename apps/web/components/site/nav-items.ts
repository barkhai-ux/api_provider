export type NavItem = { href: string; label: string; match: (pathname: string) => boolean };

export const PUBLIC_NAV: NavItem[] = [
  { href: "/", label: "Map", match: (p) => p === "/" },
  { href: "/developers", label: "Developers", match: (p) => p === "/developers" },
  { href: "/developers/docs", label: "Documentation", match: (p) => p.startsWith("/developers/docs") },
  {
    href: "/developers/api-reference",
    label: "API reference",
    match: (p) => p.startsWith("/developers/api-reference"),
  },
];

export const DASHBOARD_NAV: NavItem = {
  href: "/dashboard",
  label: "Dashboard",
  match: (p) => p.startsWith("/dashboard"),
};
