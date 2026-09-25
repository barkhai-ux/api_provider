"use client";

import { api } from "@geo-platform/convex/api";
import { usePaginatedQuery, useConvexAuth } from "convex/react";
import { Activity, ArrowRight, CalendarDays, CircleCheck, CircleX, Gauge, KeyRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useConsoleQuery } from "@/hooks/use-console-query";
import { formatNumber } from "@/lib/format";
import { useT } from "@/lib/i18n/provider";
import { EmptyState } from "./empty-state";
import { formatPercent, formatStat } from "./format";
import { PageHeader } from "./page-header";
import { RecentRequestsTable } from "./recent-requests-table";
import { RequestsChart } from "./requests-chart";
import { StatCard } from "./stat-card";

const RECENT_COUNT = 10;

export function OverviewView({ quickstart }: { quickstart: ReactNode }) {
  const t = useT();
  const { isAuthenticated } = useConvexAuth();
  const viewer = useConsoleQuery(api.users.viewer, {});
  const summary = useConsoleQuery(api.usage.summary, {});
  const daily = useConsoleQuery(api.usage.daily, { days: 30 });
  const recent = usePaginatedQuery(api.usage.recent, isAuthenticated ? {} : "skip", {
    initialNumItems: RECENT_COUNT,
  });
  const loading = summary === undefined;
  const firstName = viewer?.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? t("dashboard.home.welcome", { name: firstName }) : t("dashboard.home.overview")}
        description={t("dashboard.home.subtitle")}
        actions={
          <Button asChild size="pill" className="h-10 px-5">
            <Link href="/dashboard/api-keys">
              <KeyRound aria-hidden="true" /> {t("dashboard.home.manageKeys")}
            </Link>
          </Button>
        }
      />

      <section aria-label="Usage summary" className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-3">
        <StatCard label={t("dashboard.home.requestsToday")} icon={Activity} loading={loading} value={formatStat(summary?.today.total ?? 0)} />
        <StatCard
          label={t("dashboard.home.requestsMonth")}
          icon={CalendarDays}
          loading={loading}
          value={formatStat(summary?.month.total ?? 0)}
        />
        <StatCard
          label={t("dashboard.home.successful")}
          icon={CircleCheck}
          loading={loading}
          value={formatStat(summary?.month.successful ?? 0)}
          context={t("dashboard.home.successfulContext", { percent: formatPercent(summary?.month.successful ?? 0, summary?.month.total ?? 0) })}
        />
        <StatCard
          label={t("dashboard.home.failed")}
          icon={CircleX}
          loading={loading}
          value={formatStat(summary?.month.failed ?? 0)}
          context={t("dashboard.home.failedContext")}
        />
        <StatCard
          label={t("dashboard.home.rateLimit")}
          icon={Gauge}
          loading={loading}
          value={`${formatNumber(summary?.rateLimitPerMinute ?? 0)} / min`}
          context={t("dashboard.home.rateLimitContext")}
        />
        <StatCard
          label={t("dashboard.home.activeKeys")}
          icon={KeyRound}
          loading={loading}
          value={formatNumber(summary?.activeKeys ?? 0)}
          context={summary && summary.totalKeys > summary.activeKeys ? t("dashboard.home.revokedContext", { count: summary.totalKeys - summary.activeKeys }) : undefined}
        />
      </section>

      {summary && summary.activeKeys === 0 && summary.month.total === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={KeyRound}
            title={t("dashboard.home.emptyTitle")}
            description={t("dashboard.home.emptyDesc")}
            action={
              <Button asChild size="pill" className="h-10 px-5">
                <Link href="/dashboard/api-keys?create=1">{t("dashboard.home.createKey")}</Link>
              </Button>
            }
          >
            {quickstart}
          </EmptyState>
        </div>
      ) : (
        <div className="mt-6 grid gap-6">
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Requests, last 30 days</h2>
              </CardTitle>
              <CardDescription>Successful and failed requests per UTC day, across all keys.</CardDescription>
              <CardAction>
                <Link
                  href="/dashboard/usage"
                  className="group inline-flex items-center gap-1 text-sm font-semibold text-primary"
                >
                  View usage
                  <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </Link>
              </CardAction>
            </CardHeader>
            <CardContent>
              <RequestsChart data={daily} periodLabel="last 30 days" />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>
                <h2>Recent requests</h2>
              </CardTitle>
              <CardDescription>The latest calls made with your keys. Updates live.</CardDescription>
            </CardHeader>
            <CardContent>
              <RecentRequestsTable
                rows={recent.status === "LoadingFirstPage" ? undefined : recent.results.slice(0, RECENT_COUNT)}
                loading={recent.status === "LoadingFirstPage"}
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}
