import Link from "next/link";
import { cn } from "@/lib/utils";

/** Monmap LLC mark: a triangle (triforce) inside a circle. Inherits the accent
 * colour, so it adapts to light and dark surfaces. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7 shrink-0", className)}>
      <circle cx="16" cy="16" r="15" fill="none" className="stroke-primary" strokeWidth="1.6" />
      {/* Three filled triangles with an empty centre (the background shows through). */}
      <path d="M16 5.5 10.6 15h10.8L16 5.5Z" className="fill-primary" />
      <path d="M10.6 15 5.2 24.5H16L10.6 15Z" className="fill-primary" />
      <path d="M21.4 15 16 24.5h10.8L21.4 15Z" className="fill-primary" />
    </svg>
  );
}

/**
 * `stacked` puts "Location Service" under the name, for narrow spots such as
 * the console sidebar where the one-line wordmark does not fit.
 */
export function Logo({ className, stacked = false }: { className?: string; stacked?: boolean }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 rounded-md text-[17px] font-bold tracking-tight", className)}
      aria-label="Ubhub Location Service home"
    >
      <LogoMark className={stacked ? "size-8" : undefined} />
      {stacked ? (
        <span className="flex flex-col leading-none">
          <span>Ubhub</span>
          <span className="mt-1 text-[12px] font-semibold tracking-normal text-muted-foreground">Location Service</span>
        </span>
      ) : (
        <span className="whitespace-nowrap">Ubhub Location Service</span>
      )}
    </Link>
  );
}
