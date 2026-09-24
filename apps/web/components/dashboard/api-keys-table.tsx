"use client";

import { Lock, MoreHorizontal, Pencil, RefreshCw, Trash2 } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/use-media-query";
import { formatDate, formatDateTime, formatNumber, formatRelativeTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ApiKey } from "./api-key-types";
import { KEY_ENDPOINTS } from "./key-options";

export type KeyAction = "rename" | "regenerate" | "revoke";
type Props = { keys: ApiKey[]; onAction: (action: KeyAction, key: ApiKey) => void; caption: string };

function MaskedKey({ value }: { value: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex max-w-full items-center gap-2 rounded-lg bg-muted px-3 py-1.5 font-mono text-[12px] text-foreground/80">
          <span className="truncate">{value}</span>
          <Lock className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
        </span>
      </TooltipTrigger>
      <TooltipContent>Stored as a hash. The full key is shown only once, when created.</TooltipContent>
    </Tooltip>
  );
}

const DAY_MS = 24 * 60 * 60 * 1000;
const EXPIRY_WARNING_DAYS = 7;

function isExpired(apiKey: ApiKey, now: number): boolean {
  return apiKey.expiresAt !== null && apiKey.expiresAt <= now;
}

function ExpiredBadge() {
  return (
    <span className="rounded-md bg-destructive/10 px-1.5 py-0.5 text-[10px] font-bold tracking-wider text-destructive uppercase">
      Expired
    </span>
  );
}

function Endpoints({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.endpoints.length === KEY_ENDPOINTS.length) {
    return <span className="text-muted-foreground">All endpoints</span>;
  }
  return (
    <span className="flex flex-wrap gap-1.5">
      {KEY_ENDPOINTS.filter((endpoint) => apiKey.endpoints.includes(endpoint.id)).map((endpoint) => (
        <span
          key={endpoint.id}
          title={`GET ${endpoint.path}`}
          className="rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium whitespace-nowrap text-primary"
        >
          {endpoint.shortLabel}
        </span>
      ))}
    </span>
  );
}

function Expires({ apiKey, now }: { apiKey: ApiKey; now: number }) {
  if (apiKey.expiresAt === null) return <span className="text-muted-foreground">Never</span>;
  const soon = apiKey.expiresAt - now < EXPIRY_WARNING_DAYS * DAY_MS;
  return (
    <time
      dateTime={new Date(apiKey.expiresAt).toISOString()}
      title={formatDateTime(apiKey.expiresAt)}
      className={cn(isExpired(apiKey, now) ? "text-destructive" : soon && apiKey.revokedAt === null && "text-warning")}
    >
      {formatDate(apiKey.expiresAt)}
    </time>
  );
}

function RateLimit({ apiKey }: { apiKey: ApiKey }) {
  const percent = Math.min(100, (apiKey.requestsThisMinute / Math.max(1, apiKey.rateLimitPerMinute)) * 100);
  return (
    <span className="flex flex-col gap-1 whitespace-nowrap">
      <span className="tabular-nums">{formatNumber(apiKey.rateLimitPerMinute)} / min</span>
      <span className="flex items-center gap-2 text-xs text-muted-foreground">
        <span
          className="block h-1 w-14 overflow-hidden rounded-full bg-primary/15"
          role="meter"
          aria-label="Rate limit used this minute"
          aria-valuemin={0}
          aria-valuemax={apiKey.rateLimitPerMinute}
          aria-valuenow={Math.min(apiKey.requestsThisMinute, apiKey.rateLimitPerMinute)}
        >
          <span
            className={cn(
              "block h-full rounded-full",
              percent >= 100 ? "bg-destructive" : percent >= 80 ? "bg-warning" : "bg-primary",
            )}
            style={{ width: `${percent}%` }}
          />
        </span>
        <span className="tabular-nums">
          {formatNumber(apiKey.requestsThisMinute)} / {formatNumber(apiKey.rateLimitPerMinute)}
        </span>
      </span>
    </span>
  );
}

function LastUsed({ apiKey }: { apiKey: ApiKey }) {
  if (apiKey.revokedAt !== null) {
    return <span title={formatDateTime(apiKey.revokedAt)}>Revoked {formatDate(apiKey.revokedAt)}</span>;
  }
  if (apiKey.lastUsedAt === null) return <span className="text-muted-foreground">Never</span>;
  return (
    <time dateTime={new Date(apiKey.lastUsedAt).toISOString()} title={formatDateTime(apiKey.lastUsedAt)}>
      {formatRelativeTime(apiKey.lastUsedAt)}
    </time>
  );
}

function Actions({ apiKey, onAction, expired }: { apiKey: ApiKey; onAction: Props["onAction"]; expired: boolean }) {
  if (apiKey.revokedAt !== null) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon-sm" className="rounded-full" aria-label={`Actions for ${apiKey.name}`}>
          <MoreHorizontal />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onSelect={() => onAction("rename", apiKey)}>
          <Pencil /> Rename
        </DropdownMenuItem>
        {!expired && (
          <DropdownMenuItem onSelect={() => onAction("regenerate", apiKey)}>
            <RefreshCw /> Regenerate secret
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onSelect={() => onAction("revoke", apiKey)}>
          <Trash2 /> Revoke
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm">{children}</dd>
    </div>
  );
}

/** API keys as a table (desktop) or stacked cards (mobile), like a console's key list. */
export function ApiKeysTable({ keys, onAction, caption }: Props) {
  const wide = useMediaQuery("(min-width: 768px)");
  // Expiry is shown relative to when the list rendered; Convex re-renders it on every change.
  const [now] = useState(() => Date.now());

  if (!wide) {
    return (
      <div className="overflow-hidden rounded-2xl bg-background shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
        {keys.map((apiKey) => (
          <section
            key={apiKey.id}
            role="group"
            aria-label={`API key ${apiKey.name}`}
            className={cn("border-b p-5 last:border-b-0", apiKey.revokedAt !== null && "opacity-60")}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs text-muted-foreground">Name</p>
                <p className="mt-1 flex items-center gap-2 font-semibold">
                  <span className="truncate">{apiKey.name}</span>
                  {isExpired(apiKey, now) && <ExpiredBadge />}
                </p>
              </div>
              <Actions apiKey={apiKey} onAction={onAction} expired={isExpired(apiKey, now)} />
            </div>
            <dl className="mt-4 grid gap-4">
              <Field label="API key">
                <MaskedKey value={apiKey.maskedKey} />
              </Field>
              <Field label="Endpoints">
                <Endpoints apiKey={apiKey} />
              </Field>
              {apiKey.revokedAt === null && (
                <Field label="Limit">
                  <RateLimit apiKey={apiKey} />
                </Field>
              )}
              <div className="grid grid-cols-2 gap-4">
                <Field label="Requests, 30 days">
                  <span className="tabular-nums">{formatNumber(apiKey.requestsLast30Days)}</span>
                </Field>
                <Field label="Last used">
                  <LastUsed apiKey={apiKey} />
                </Field>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <Field label="Expires">
                  <Expires apiKey={apiKey} now={now} />
                </Field>
                <Field label="Created">
                  <span title={formatDateTime(apiKey.createdAt)}>{formatDate(apiKey.createdAt)}</span>
                </Field>
              </div>
            </dl>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto rounded-2xl bg-background shadow-[0_1px_3px_rgb(15_23_42/0.06)]">
      <table className="w-full min-w-[900px] text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b text-left text-xs whitespace-nowrap text-muted-foreground">
            <th scope="col" className="py-4 pr-4 pl-6 font-medium">Name</th>
            <th scope="col" className="px-4 py-4 font-medium">API key</th>
            <th scope="col" className="px-4 py-4 font-medium">Endpoints</th>
            <th scope="col" className="px-4 py-4 font-medium">Limit</th>
            <th scope="col" className="px-4 py-4 font-medium">Usage, 30 days</th>
            <th scope="col" className="px-4 py-4 font-medium">Expires</th>
            <th scope="col" className="py-4 pr-6 pl-2">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {keys.map((apiKey) => (
            <tr
              key={apiKey.id}
              aria-label={`API key ${apiKey.name}`}
              className={cn("border-b align-middle last:border-b-0", apiKey.revokedAt !== null && "opacity-60")}
            >
              <th scope="row" className="py-5 pr-4 pl-6 text-left">
                <span className="flex items-center gap-2 font-semibold">
                  <span className="max-w-44 truncate">{apiKey.name}</span>
                  {isExpired(apiKey, now) && <ExpiredBadge />}
                </span>
                <span className="mt-0.5 block text-xs font-normal text-muted-foreground" title={formatDateTime(apiKey.createdAt)}>
                  Created {formatDate(apiKey.createdAt)}
                </span>
              </th>
              <td className="px-4 py-5">
                <MaskedKey value={apiKey.maskedKey} />
              </td>
              <td className="px-4 py-5">
                <Endpoints apiKey={apiKey} />
              </td>
              <td className="px-4 py-5">{apiKey.revokedAt === null ? <RateLimit apiKey={apiKey} /> : "—"}</td>
              <td className="px-4 py-5 whitespace-nowrap">
                <span className="block tabular-nums">
                  {formatNumber(apiKey.requestsLast30Days)} {apiKey.requestsLast30Days === 1 ? "request" : "requests"}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {apiKey.revokedAt !== null ? (
                    <LastUsed apiKey={apiKey} />
                  ) : apiKey.lastUsedAt === null ? (
                    "Never used"
                  ) : (
                    <>
                      Last used <LastUsed apiKey={apiKey} />
                    </>
                  )}
                </span>
              </td>
              <td className="px-4 py-5 whitespace-nowrap">
                <Expires apiKey={apiKey} now={now} />
              </td>
              <td className="py-5 pr-6 pl-2 text-right">
                <Actions apiKey={apiKey} onAction={onAction} expired={isExpired(apiKey, now)} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
