import Link from "next/link";
import { cn } from "@/lib/utils";

/** Pin inside a circle: the platform mark. Inherits `currentColor` for the ring. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" className={cn("size-7", className)}>
      <circle cx="16" cy="16" r="16" className="fill-primary" />
      <path
        d="M16 7.5a6.5 6.5 0 0 0-6.5 6.5c0 4.6 6.5 11 6.5 11s6.5-6.4 6.5-11A6.5 6.5 0 0 0 16 7.5Z"
        fill="#fff"
      />
      <circle cx="16" cy="14" r="2.4" className="fill-primary" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn("flex items-center gap-2.5 rounded-md text-[17px] font-bold tracking-tight", className)}
      aria-label="Geo Platform home"
    >
      <LogoMark />
      <span>geoplatform</span>
    </Link>
  );
}
