import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatNumber } from "@/lib/format";
import { formatLatency, formatPercent } from "./format";

export type EndpointUsage = {
  endpoint: string;
  total: number;
  successful: number;
  failed: number;
  avgResponseTimeMs: number;
};

export function EndpointTable({ rows }: { rows: EndpointUsage[] | undefined }) {
  if (!rows) {
    return (
      <div className="space-y-2" aria-busy="true" aria-label="Loading endpoints">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }
  if (rows.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">No requests in this period.</p>;
  }
  return (
    <div className="overflow-x-auto">
      <Table>
        <caption className="sr-only">Requests per endpoint</caption>
        <TableHeader>
          <TableRow>
            <TableHead>Endpoint</TableHead>
            <TableHead className="text-right">Requests</TableHead>
            <TableHead className="text-right">Successful</TableHead>
            <TableHead className="text-right">Failed</TableHead>
            <TableHead className="text-right">Avg. latency</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow key={row.endpoint}>
              <TableCell className="font-mono text-xs">{row.endpoint}</TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.total)}</TableCell>
              <TableCell className="text-right tabular-nums">
                {formatNumber(row.successful)}
                <span className="ml-1 text-xs text-muted-foreground">({formatPercent(row.successful, row.total)})</span>
              </TableCell>
              <TableCell className="text-right tabular-nums">{formatNumber(row.failed)}</TableCell>
              <TableCell className="text-right tabular-nums">{formatLatency(row.avgResponseTimeMs)}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
