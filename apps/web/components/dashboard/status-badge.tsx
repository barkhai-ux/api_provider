import { CircleAlert, CircleCheck, CircleX } from "lucide-react";
import { cn } from "@/lib/utils";

/** HTTP status with an icon and color: 2xx success, 4xx warning, 5xx error. */
export function StatusBadge({ status }: { status: number }) {
  const kind = status >= 500 ? "error" : status >= 400 ? "warning" : "success";
  const Icon = kind === "error" ? CircleX : kind === "warning" ? CircleAlert : CircleCheck;
  const label = kind === "error" ? "Server error" : kind === "warning" ? "Client error" : "Success";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-xs font-medium tabular-nums",
        kind === "success" && "bg-success/10 text-success",
        kind === "warning" && "bg-warning/15 text-foreground",
        kind === "error" && "bg-destructive/10 text-destructive",
      )}
    >
      <Icon className={cn("size-3.5", kind === "warning" && "text-warning")} aria-hidden="true" />
      {status}
      <span className="sr-only">({label})</span>
    </span>
  );
}
