import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/** A single headline number (label, value, optional context line). */
export function StatCard({
  label,
  value,
  context,
  icon: Icon,
  loading,
}: {
  label: string;
  value: string;
  context?: ReactNode;
  icon?: LucideIcon;
  loading?: boolean;
}) {
  return (
    <Card className="gap-1.5 p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] font-medium text-muted-foreground sm:text-sm">{label}</p>
        {Icon && (
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-primary sm:size-8">
            <Icon className="size-4" aria-hidden="true" />
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-1 h-8 w-24" />
      ) : (
        <p className="text-2xl leading-tight font-bold tracking-tight tabular-nums sm:text-[28px]">{value}</p>
      )}
      {context && <div className="text-xs text-muted-foreground">{loading ? <Skeleton className="h-4 w-32" /> : context}</div>}
    </Card>
  );
}
