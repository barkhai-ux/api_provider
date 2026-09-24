"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@geo-platform/convex/api";
import { useQueryClient } from "@tanstack/react-query";
import { useQuery } from "convex/react";
import { BookOpen, ChevronDown, LogOut, Menu, Settings } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Logo } from "@/components/site/logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { CONSOLE_NAV, SETTINGS_NAV, isActive, type ConsoleNavItem } from "./nav-items";

function initials(name: string, email: string): string {
  const parts = (name.trim() || email).split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function NavList({ items, pathname, onNavigate }: { items: ConsoleNavItem[]; pathname: string; onNavigate?: () => void }) {
  return (
    <ul className="flex flex-col gap-0.5">
      {items.map((item) => {
        const active = isActive(item, pathname);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              onClick={onNavigate}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex items-center gap-3 rounded-xl px-3 py-2 text-[14px] font-medium text-foreground/70 transition-colors hover:bg-background/70 hover:text-foreground",
                active && "bg-background font-semibold text-primary shadow-[0_1px_3px_rgb(15_23_42/0.06)]",
              )}
            >
              <Icon className="size-[18px]" aria-hidden="true" />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function SidebarNav({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Developer console" className="flex flex-col gap-8">
      <NavList items={CONSOLE_NAV} pathname={pathname} onNavigate={onNavigate} />
      <div>
        <p className="px-3 pb-2 text-[11px] font-bold tracking-[0.14em] text-muted-foreground uppercase">Settings</p>
        <NavList items={SETTINGS_NAV} pathname={pathname} onNavigate={onNavigate} />
      </div>
    </nav>
  );
}

function UserMenu() {
  const viewer = useQuery(api.users.viewer, {});
  const { signOut } = useAuthActions();
  const queryClient = useQueryClient();
  const router = useRouter();
  const name = viewer?.name ?? "";
  const email = viewer?.email ?? "";

  async function handleSignOut() {
    await signOut();
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    router.push("/");
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-2 rounded-full bg-background py-1 pr-3 pl-1 text-sm font-semibold shadow-[0_1px_3px_rgb(15_23_42/0.08)] transition-colors hover:bg-background/80"
          aria-label="Account menu"
        >
          <Avatar className="size-7">
            <AvatarFallback className="bg-primary/10 text-[11px] font-bold text-primary">
              {viewer ? initials(name, email) : ""}
            </AvatarFallback>
          </Avatar>
          <span className="hidden max-w-40 truncate sm:inline">{name || "Account"}</span>
          <ChevronDown className="size-4 text-muted-foreground" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-semibold">{name || "Developer"}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings /> Account settings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/developers/docs">
            <BookOpen /> Documentation
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={handleSignOut}>
          <LogOut /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Developer console frame: light canvas, borderless sidebar, top bar with the account menu. */
export function DashboardShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="console-shell flex min-h-dvh flex-1 bg-canvas">
      <aside className="hidden w-64 shrink-0 lg:block">
        <div className="sticky top-0 flex h-dvh flex-col gap-10 px-5 py-7">
          <Logo className="px-3" />
          <SidebarNav pathname={pathname} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:h-20 lg:px-10">
          <Logo className="lg:hidden" />
          <div className="ml-auto flex items-center gap-2">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button asChild variant="ghost" size="icon" className="rounded-full">
                  <Link href="/developers/docs" aria-label="Documentation">
                    <BookOpen />
                  </Link>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Documentation</TooltipContent>
            </Tooltip>
            <UserMenu />
            <Sheet open={open} onOpenChange={setOpen}>
              <SheetTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-full lg:hidden" aria-label="Open menu">
                  <Menu />
                </Button>
              </SheetTrigger>
              <SheetContent side="left" className="w-72 bg-canvas">
                <SheetHeader>
                  <SheetTitle>
                    <Logo />
                  </SheetTitle>
                </SheetHeader>
                <div className="px-3">
                  <SidebarNav pathname={pathname} onNavigate={() => setOpen(false)} />
                </div>
              </SheetContent>
            </Sheet>
          </div>
        </header>
        <main id="main" className="min-w-0 flex-1 px-4 pb-16 sm:px-6 lg:px-10">
          <div className="mx-auto w-full max-w-6xl">{children}</div>
        </main>
      </div>
    </div>
  );
}
