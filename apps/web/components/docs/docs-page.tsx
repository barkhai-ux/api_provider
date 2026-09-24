import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { DOCS_PAGES, type TocEntry } from "@/lib/docs-nav";

/**
 * One documentation page: content column plus the "On this page" table of
 * contents (desktop only) and previous/next links.
 */
export function DocsPage({
  href,
  eyebrow,
  title,
  description,
  toc,
  children,
}: {
  href: string;
  eyebrow?: string;
  title: string;
  description: ReactNode;
  toc: TocEntry[];
  children: ReactNode;
}) {
  const index = DOCS_PAGES.findIndex((page) => page.href === href);
  const previous = index > 0 ? DOCS_PAGES[index - 1] : undefined;
  const next = index >= 0 && index < DOCS_PAGES.length - 1 ? DOCS_PAGES[index + 1] : undefined;

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 xl:max-w-[760px]">
        <header>
          {eyebrow && <p className="text-sm font-medium text-primary">{eyebrow}</p>}
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">{title}</h1>
          <p className="mt-3 text-lg leading-8 text-muted-foreground">{description}</p>
        </header>
        <div className="mt-8 text-[15px]">{children}</div>
        <nav aria-label="Pagination" className="mt-16 grid gap-3 border-t pt-6 sm:grid-cols-2">
          {previous ? (
            <Link
              href={previous.href}
              className="group rounded-lg border p-4 text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="flex items-center gap-1 text-muted-foreground">
                <ArrowLeft className="size-3.5" /> Previous
              </span>
              <span className="mt-1 block font-medium">{previous.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link
              href={next.href}
              className="group rounded-lg border p-4 text-right text-sm transition-colors hover:border-primary/40 hover:bg-muted/40"
            >
              <span className="flex items-center justify-end gap-1 text-muted-foreground">
                Next <ArrowRight className="size-3.5" />
              </span>
              <span className="mt-1 block font-medium">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      <aside className="hidden w-52 shrink-0 xl:block" aria-label="On this page">
        <div className="sticky top-24">
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">On this page</p>
          <ul className="mt-3 flex flex-col gap-2 border-l text-sm">
            {toc.map((entry) => (
              <li key={entry.id}>
                <a
                  href={`#${entry.id}`}
                  className="-ml-px block border-l border-transparent pl-3 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
                >
                  {entry.title}
                </a>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
