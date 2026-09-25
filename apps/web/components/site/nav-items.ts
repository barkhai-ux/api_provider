export type NavItem = { href: string; labelKey: string; match: (pathname: string) => boolean };

export const PUBLIC_NAV: NavItem[] = [
  { href: "/", labelKey: "nav.map", match: (p) => p === "/" },
  { href: "/developers", labelKey: "nav.developers", match: (p) => p === "/developers" },
  { href: "/developers/docs", labelKey: "nav.documentation", match: (p) => p.startsWith("/developers/docs") },
  {
    href: "/developers/api-reference",
    labelKey: "nav.apiReference",
    match: (p) => p.startsWith("/developers/api-reference"),
  },
];

export const DASHBOARD_NAV: NavItem = {
  href: "/dashboard",
  labelKey: "authNav.dashboard",
  match: (p) => p.startsWith("/dashboard"),
};
