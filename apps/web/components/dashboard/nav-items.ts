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

export type ConsoleNavItem = { href: string; label: string; icon: LucideIcon; exact?: boolean; external?: boolean };

export const CONSOLE_NAV: ConsoleNavItem[] = [
  { href: "/dashboard", label: "Home", icon: House, exact: true },
  { href: "/dashboard/api-keys", label: "API keys", icon: KeyRound },
  { href: "/dashboard/usage", label: "Usage", icon: ChartColumn },
  { href: "/developers/api-reference", label: "API playground", icon: FlaskConical, external: true },
  { href: "/developers/docs", label: "Docs", icon: BookOpen, external: true },
  { href: "/", label: "Map", icon: MapIcon, external: true },
];

export const SETTINGS_NAV: ConsoleNavItem[] = [{ href: "/dashboard/settings", label: "Settings", icon: Settings }];

export function isActive(item: ConsoleNavItem, pathname: string): boolean {
  if (item.external) return false;
  return item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
}
