"use client";

import { api } from "@geo-platform/convex/api";
import type { Id } from "@geo-platform/convex/dataModel";
import { useConvexAuth, usePaginatedQuery } from "convex/react";
import { LoaderCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useConsoleQuery, useStableValue } from "@/hooks/use-console-query";
import { EndpointTable } from "./endpoint-table";
import { PageHeader } from "./page-header";
import { useT } from "@/lib/i18n/provider";
import { RecentRequestsTable } from "./recent-requests-table";
import { RequestsChart } from "./requests-chart";

const RANGES = [7, 30, 90] as const;
type Range = (typeof RANGES)[number];
const ALL_KEYS = "all";
const PAGE_SIZE = 25;

export function UsageView() {
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const [days, setDays] = useState<Range>(30);
  const [keyFilter, setKeyFilter] = useState<string>(ALL_KEYS);
  const keyId = keyFilter === ALL_KEYS ? undefined : (keyFilter as Id<"apiKeys">);
  const periodLabel = `last ${days} days`;

  const keys = useConsoleQuery(api.apiKeys.list, {});
  const daily = useStableValue(useConsoleQuery(api.usage.daily, { days, keyId }));
  const endpoints = useStableValue(useConsoleQuery(api.usage.endpoints, { days, keyId }));
  const recent = usePaginatedQuery(api.usage.recent, isAuthenticated ? { keyId } : "skip", {
    initialNumItems: PAGE_SIZE,
  });

  return (
    <>
      <PageHeader title={t("dashboard.usage.title")} description={t("dashboard.usage.subtitle")} />

      <div className="mb-6 flex flex-wrap items-end gap-4" role="group" aria-label="Filters">
        <div className="grid gap-2">
          <span id="range-label" className="text-sm leading-none font-medium">
            Period
          </span>
          <ToggleGroup
            type="single"
            spacing={1}
            value={String(days)}
            onValueChange={(value) => value && setDays(Number(value) as Range)}
            aria-labelledby="range-label"
            className="rounded-full bg-background p-1 shadow-[0_1px_3px_rgb(15_23_42/0.06)]"
          >
            {RANGES.map((range) => (
              <ToggleGroupItem
                key={range}
                value={String(range)}
                aria-label={`Last ${range} days`}
                className="h-8 rounded-full px-3.5 data-[state=on]:bg-primary data-[state=on]:text-primary-foreground"
              >
                {range} days
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="key-filter">API key</Label>
          <Select value={keyFilter} onValueChange={setKeyFilter}>
            <SelectTrigger
              id="key-filter"
              className="h-10! w-60 max-w-full rounded-full border-transparent bg-background px-4 shadow-[0_1px_3px_rgb(15_23_42/0.06)]"
            >
              <SelectValue placeholder="All keys" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_KEYS}>All keys</SelectItem>
              {keys?.map((key) => (
                <SelectItem key={key.id} value={key.id}>
                  {key.name}
                  {key.revokedAt !== null ? " (revoked)" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Requests per day</h2>
            </CardTitle>
            <CardDescription>Successful (2xx) and failed (4xx, 5xx) requests, {periodLabel}.</CardDescription>
          </CardHeader>
          <CardContent>
            <RequestsChart data={daily.value} stale={daily.stale} periodLabel={periodLabel} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>By endpoint</h2>
            </CardTitle>
            <CardDescription>Totals and average response time, {periodLabel}.</CardDescription>
          </CardHeader>
          <CardContent className={endpoints.stale ? "opacity-60 transition-opacity" : "transition-opacity"}>
            <EndpointTable rows={endpoints.value} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>
              <h2>Request log</h2>
            </CardTitle>
            <CardDescription>
              Newest first. Detailed records are kept for 30 days; daily totals are kept longer.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <RecentRequestsTable
              rows={recent.status === "LoadingFirstPage" ? undefined : recent.results}
              loading={recent.status === "LoadingFirstPage"}
              caption="Request log"
            />
            {(recent.status === "CanLoadMore" || recent.status === "LoadingMore") && (
              <div className="flex justify-center">
                <Button
                  variant="outline"
                  onClick={() => recent.loadMore(PAGE_SIZE)}
                  disabled={recent.status === "LoadingMore"}
                >
                  {recent.status === "LoadingMore" && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                  Load more
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
