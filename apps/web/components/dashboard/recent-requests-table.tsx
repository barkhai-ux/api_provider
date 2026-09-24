import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDateTime, formatRelativeTime } from "@/lib/format";
import { formatLatency } from "./format";
import { StatusBadge } from "./status-badge";

export type RecentRequest = {
  id: string;
  keyName: string;
  endpoint: string;
  method: string;
  statusCode: number;
  responseTimeMs: number;
  timestamp: number;
};

export function RecentRequestsTable({
  rows,
  loading,
  caption = "Recent API requests",
}: {
  rows: RecentRequest[] | undefined;
  loading?: boolean;
  caption?: string;
}) {
  if (loading && !rows) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading requests">
        {Array.from({ length: 5 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No requests yet.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">{caption}</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Endpoint</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="text-right">Latency</TableHead>
            <TableHead className="hidden sm:table-cell">Key</TableHead>
            <TableHead className="text-right">Time</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.id}>
              <TableCell className="font-mono text-xs">
                <span className="mr-1.5 text-muted-foreground">{row.method}</span>
                {row.endpoint}
              </TableCell>
              <TableCell>
                <StatusBadge status={row.statusCode} />
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatLatency(row.responseTimeMs)}</TableCell>
              <TableCell className="hidden max-w-40 truncate sm:table-cell">{row.keyName}</TableCell>
              <TableCell className="text-right whitespace-nowrap text-muted-foreground">
                <time dateTime={new Date(row.timestamp).toISOString()} title={formatDateTime(row.timestamp)}>
                  {formatRelativeTime(row.timestamp)}
                </time>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
