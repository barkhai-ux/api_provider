import Link from "next/link";
import { cn } from "@/lib/utils";

/** Monmap LLC mark: a triangle (triforce) inside a circle. Inherits the accent
 * colour, so it adapts to light and dark surfaces. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <circle cx="16" cy="16" r="15" fill="none" className="stroke-primary" strokeWidth="1.6" />
      {/* Three filled triangles with an empty centre (the background shows through). */}
      <path d="M16 5.5 10.6 15h10.8L16 5.5Z" className="fill-primary" />
      <path d="M10.6 15 5.2 24.5H16L10.6 15Z" className="fill-primary" />
      <path d="M21.4 15 16 24.5h10.8L21.4 15Z" className="fill-primary" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 rounded-md text-[17px] font-bold tracking-tight", className)}
      aria-label="Ubhub Location Service home"
    >
      <LogoMark />
      <span className="whitespace-nowrap">Ubhub Location Service</span>
    </Link>
  );
}
