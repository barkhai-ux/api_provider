"use client";

import { Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useSession } from "@/hooks/use-session";
import { cn } from "@/lib/utils";
import { AuthNav } from "./auth-nav";
import { Logo } from "./logo";
import { DASHBOARD_NAV, PUBLIC_NAV } from "./nav-items";

/** Site-wide header: dark on every page, above light or dark content. */
export function SiteHeader() {
  const pathname = usePathname();
  const { data } = useSession();
  const [open, setOpen] = useState(false);
  const items = data?.authenticated ? [...PUBLIC_NAV, DASHBOARD_NAV] : PUBLIC_NAV;

  return (
    <header className="theme-dark sticky top-0 z-40 border-b bg-background text-foreground">
      <div className="mx-auto flex h-16 max-w-[1400px] items-center gap-10 px-4 sm:px-6 lg:px-8">
        <Logo />
        <nav aria-label="Main" className="hidden items-center gap-1 lg:flex">
          {items.map((item) => {
            const active = item.match(pathname);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-2 text-[15px] font-semibold text-foreground/75 transition-colors hover:text-foreground",
                  active && "text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto hidden lg:block">
          <AuthNav />
        </div>
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="ml-auto lg:hidden" aria-label="Open menu">
              <Menu />
            </Button>
          </SheetTrigger>
          <SheetContent side="right" className="theme-dark w-80 bg-background text-foreground">
            <SheetHeader>
              <SheetTitle>Menu</SheetTitle>
            </SheetHeader>
            <nav aria-label="Main" className="flex flex-col gap-1 px-4">
              {items.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={() => setOpen(false)}
                  aria-current={item.match(pathname) ? "page" : undefined}
                  className={cn(
                    "rounded-md px-3 py-2.5 text-[15px] font-semibold text-foreground/80 hover:bg-accent",
                    item.match(pathname) && "bg-accent text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
            <div className="mt-4 border-t px-4 pt-4">
              <AuthNav compact />
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
}
