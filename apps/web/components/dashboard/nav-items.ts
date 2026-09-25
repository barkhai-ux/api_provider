import {
  BookOpen,
  ChartColumn,
  FlaskConical,
  House,
  KeyRound,
  Map as MapIcon,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type ConsoleNavItem = { href: string; labelKey: string; icon: LucideIcon; exact?: boolean; external?: boolean };

export const CONSOLE_NAV: ConsoleNavItem[] = [
  { href: "/dashboard", labelKey: "dashboard.nav.home", icon: House, exact: true },
  { href: "/dashboard/api-keys", labelKey: "dashboard.nav.apiKeys", icon: KeyRound },
  { href: "/dashboard/usage", labelKey: "dashboard.nav.usage", icon: ChartColumn },
  { href: "/developers/api-reference", labelKey: "dashboard.nav.apiPlayground", icon: FlaskConical, external: true },
  { href: "/developers/docs", labelKey: "dashboard.nav.docs", icon: BookOpen, external: true },
  { href: "/", labelKey: "dashboard.nav.map", icon: MapIcon, external: true },
];

export const SETTINGS_NAV: ConsoleNavItem[] = [{ href: "/dashboard/settings", labelKey: "dashboard.nav.settings", icon: Settings }];

export function isActive(item: ConsoleNavItem, pathname: string): boolean {
  if (item.external) return false;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
