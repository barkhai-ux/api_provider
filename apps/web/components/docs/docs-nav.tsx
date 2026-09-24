"use client";

import { BookOpen, Menu } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { DOCS_NAV, isActiveDocsLink } from "@/lib/docs-nav";
import { cn } from "@/lib/utils";

/** Section list used in the desktop sidebar and in the mobile sheet. */
export function DocsNavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname() ?? "";
  return (
    <nav aria-label="Documentation" className="flex flex-col gap-6 text-sm">
      {DOCS_NAV.map((section) => (
        <div key={section.title}>
          <p className="mb-2 px-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">{section.title}</p>
          <ul className="flex flex-col gap-0.5">
            {section.items.map((item) => {
              const active = isActiveDocsLink(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block rounded-md px-3 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                      active && "bg-primary/10 font-medium text-primary hover:bg-primary/10 hover:text-primary",
                    )}
                  >
                    {item.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

/** Collapsed navigation for tablet and mobile widths. */
export function DocsMobileNav({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname() ?? "";
  const current = DOCS_NAV.flatMap((section) => section.items).find((item) => isActiveDocsLink(pathname, item.href));
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm">
            <Menu /> Docs menu
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 overflow-y-auto">
          <SheetHeader>
            <SheetTitle className="flex items-center gap-2">
              <BookOpen className="size-4" /> Documentation
            </SheetTitle>
            <SheetDescription className="sr-only">Documentation sections</SheetDescription>
          </SheetHeader>
          <div className="px-2 pb-6">
            <DocsNavList onNavigate={() => setOpen(false)} />
          </div>
        </SheetContent>
      </Sheet>
      {current && <span className="truncate text-sm text-muted-foreground">{current.title}</span>}
    </div>
  );
}
