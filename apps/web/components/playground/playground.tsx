"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useQuery } from "@tanstack/react-query";
import { KeyRound, Loader2, Send } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { CopyButton } from "@/components/docs/copy-button";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { publicConfig } from "@/lib/config";
import { cn } from "@/lib/utils";
import {
  PLAYGROUND_ENDPOINTS,
  buildCurl,
  buildRequestPath,
  defaultValues,
  statusLine,
  type PlaygroundEndpointId,
} from "./endpoints";

type ConnectedKey = { id: string; name: string; maskedKey: string; endpoints: PlaygroundEndpointId[] };
type KeysState = { status: "signed-out" } | { status: "ok"; keys: ConnectedKey[] };
type AuthMode = "connected" | "paste";

type Result =
  | {
      kind: "response";
      status: number;
      statusText: string;
      elapsedMs: number;
      body: string;
      rateLimit: { limit: string; remaining: string; reset: string } | null;
      requestId: string | null;
    }
  | { kind: "error"; message: string };

const TOKEN_REFRESH_MARGIN_MS = 60_000;
const selectClassName =
  "h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30";

async function fetchKeys(signal: AbortSignal): Promise<KeysState> {
  const response = await fetch("/api/playground/keys", { signal, cache: "no-store" });
  if (!response.ok) {
    // Release the connection; the error body is not needed.
    await response.body?.cancel();
    if (response.status === 401) return { status: "signed-out" };
    throw new Error("Could not load your API keys.");
  }
  const body = (await response.json()) as { keys: ConnectedKey[] };
  return { status: "ok", keys: body.keys };
}

function statusTone(status: number): string {
  if (status < 300) return "bg-success/10 text-success";
  if (status < 500) return "bg-warning/10 text-warning";
  return "bg-destructive/10 text-destructive";
}

/**
 * Interactive request builder for one /v1 endpoint. Requests go directly from
 * the browser to the public API, authenticated either with a short-lived
 * playground token for one of the developer's keys or with a pasted key that
 * only lives in component state.
 */
export function Playground({ endpoint: endpointId, className }: { endpoint: PlaygroundEndpointId; className?: string }) {
  const endpoint = PLAYGROUND_ENDPOINTS[endpointId];
  const apiUrl = publicConfig.apiUrl;
  const pathname = usePathname() ?? "/developers/api-reference";
  const formId = useId();

  const [authMode, setAuthMode] = useState<AuthMode>("connected");
  const [pastedKey, setPastedKey] = useState("");
  const [selectedKeyId, setSelectedKeyId] = useState("");
  const [authError, setAuthError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const tokens = useRef(new Map<string, { token: string; expiresAt: number }>());
  const abortRef = useRef<AbortController | null>(null);

  const keys = useQuery({
    queryKey: ["playground-keys"],
    queryFn: ({ signal }) => fetchKeys(signal),
    staleTime: 60_000,
    retry: false,
  });

  const allKeys = keys.data?.status === "ok" ? keys.data.keys : [];
  // Only keys allowed to call this endpoint can be used here.
  const connectedKeys = allKeys.filter((key) => key.endpoints.includes(endpointId));
  const effectiveKeyId = connectedKeys.some((key) => key.id === selectedKeyId)
    ? selectedKeyId
    : (connectedKeys[0]?.id ?? "");

  useEffect(() => () => abortRef.current?.abort(), []);

  const form = useForm<Record<string, string>>({
    resolver: zodResolver(endpoint.schema),
    defaultValues: defaultValues(endpoint),
    mode: "onSubmit",
  });
  const values = useWatch({ control: form.control }) as Record<string, string>;
  const path = buildRequestPath(endpoint, { ...defaultValues(endpoint), ...values });
  const curl = buildCurl(apiUrl, path);

  async function playgroundToken(keyId: string): Promise<string> {
    const cached = tokens.current.get(keyId);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;
    const response = await fetch("/api/playground/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keyId }),
    });
    const body = (await response.json().catch(() => null)) as
      | { token: string; expiresAt: number }
      | { error?: { message?: string } }
      | null;
    if (!response.ok || !body || !("token" in body)) {
      const message = body && "error" in body ? body.error?.message : undefined;
      throw new Error(message ?? "Could not authorize the playground with this key.");
    }
    tokens.current.set(keyId, body);
    return body.token;
  }

  async function send(formValues: Record<string, string>) {
    setAuthError(null);
    let credential: string;
    try {
      if (authMode === "paste") {
        credential = pastedKey.trim();
        if (!credential) {
          setAuthError("Paste an API key to send the request.");
          return;
        }
      } else {
        if (keys.data?.status !== "ok") {
          setAuthError("Sign in to use one of your keys, or paste a key.");
          return;
        }
        if (!effectiveKeyId) {
          setAuthError("Create an API key in the dashboard first, or paste a key.");
          return;
        }
        credential = await playgroundToken(effectiveKeyId);
      }
    } catch (error) {
      setAuthError((error as Error).message);
      return;
    }

    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestPath = buildRequestPath(endpoint, formValues);
    const started = performance.now();
    setPending(true);
    try {
      const response = await fetch(`${apiUrl}${requestPath}`, {
        headers: { Accept: "application/json", Authorization: `Bearer ${credential}` },
        signal: controller.signal,
      });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not JSON: show the raw body.
      }
      const limit = response.headers.get("X-RateLimit-Limit");
      setResult({
        kind: "response",
        status: response.status,
        statusText: response.statusText,
        elapsedMs: Math.round(performance.now() - started),
        body,
        rateLimit:
          limit === null
            ? null
            : {
                limit,
                remaining: response.headers.get("X-RateLimit-Remaining") ?? "",
                reset: response.headers.get("X-RateLimit-Reset") ?? "",
              },
        requestId: response.headers.get("X-Request-ID"),
      });
    } catch {
      if (controller.signal.aborted) return;
      setResult({
        kind: "error",
        message: `Could not reach ${apiUrl}. Check that the API is running and that its CORS settings allow this site.`,
      });
    } finally {
      if (abortRef.current === controller) setPending(false);
    }
  }

  return (
    <section
      aria-label={`${endpoint.title} playground`}
      className={cn("not-prose mt-6 overflow-hidden rounded-xl border bg-card", className)}
    >
      <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 px-4 py-3">
        <span className="inline-flex h-6 items-center rounded-md bg-primary/10 px-2 font-mono text-xs font-semibold text-primary">
          {endpoint.method}
        </span>
        <code className="font-mono text-sm">{endpoint.path}</code>
        <span className="ml-auto text-xs text-muted-foreground">Playground</span>
      </div>

      <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <form
          method="post"
          id={formId}
          noValidate
          onSubmit={(event) => void form.handleSubmit(send)(event)}
          className="flex min-w-0 flex-col gap-4 border-b p-4 lg:border-r lg:border-b-0"
        >
          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">Parameters</legend>
            {endpoint.params.map((param) => {
              const inputId = `${formId}-${param.name}`;
              const error = form.formState.errors[param.name]?.message;
              return (
                <div key={param.name} className="flex flex-col gap-1.5">
                  <Label htmlFor={inputId} className="font-mono text-xs">
                    {param.label}
                    {param.required && (
                      <span className="text-destructive" aria-hidden="true">
                        *
                      </span>
                    )}
                  </Label>
                  {param.kind === "select" ? (
                    <select id={inputId} className={selectClassName} {...form.register(param.name)}>
                      {param.options?.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      id={inputId}
                      inputMode={param.inputMode ?? "text"}
                      autoComplete="off"
                      spellCheck={false}
                      aria-invalid={error ? true : undefined}
                      aria-describedby={`${inputId}-hint`}
                      {...form.register(param.name)}
                    />
                  )}
                  <p id={`${inputId}-hint`} className={cn("text-xs", error ? "text-destructive" : "text-muted-foreground")}>
                    {error ? String(error) : param.description}
                  </p>
                </div>
              );
            })}
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-1 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Authorization
            </legend>
            <div role="radiogroup" aria-label="Authorization" className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1">
              {(
                [
                  ["connected", "Connected API key"],
                  ["paste", "Paste a key"],
                ] as const
              ).map(([mode, label]) => (
                <label
                  key={mode}
                  className={cn(
                    "flex cursor-pointer items-center justify-center rounded-md px-2 py-1.5 text-center text-xs font-medium text-muted-foreground has-focus-visible:outline-2 has-focus-visible:outline-ring",
                    authMode === mode && "bg-background text-foreground shadow-sm",
                  )}
                >
                  <input
                    type="radio"
                    name={`${formId}-auth`}
                    value={mode}
                    checked={authMode === mode}
                    onChange={() => {
                      setAuthMode(mode);
                      setAuthError(null);
                    }}
                    className="sr-only"
                  />
                  {label}
                </label>
              ))}
            </div>

            {authMode === "connected" ? (
              keys.isPending ? (
                <p className="text-xs text-muted-foreground">Loading your keys…</p>
              ) : keys.data?.status === "signed-out" || keys.isError ? (
                <p className="text-sm text-muted-foreground">
                  <Link
                    href={`/login?next=${encodeURIComponent(pathname)}`}
                    className="font-medium text-primary underline underline-offset-4"
                  >
                    Sign in to use your keys
                  </Link>
                  , or paste a key.
                </p>
              ) : connectedKeys.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {allKeys.length === 0 ? "You have no active keys." : "None of your keys can call this endpoint."}{" "}
                  <Link href="/dashboard/api-keys" className="font-medium text-primary underline underline-offset-4">
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor={`${formId}-key`} className="text-xs">
                    API key
                  </Label>
                  <select
                    id={`${formId}-key`}
                    className={selectClassName}
                    value={effectiveKeyId}
                    onChange={(event) => setSelectedKeyId(event.target.value)}
                  >
                    {connectedKeys.map((key) => (
                      <option key={key.id} value={key.id}>
                        {key.name} ({key.maskedKey})
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">
                    Sent as a 15-minute playground token. The key itself never reaches this page.
                  </p>
                </div>
              )
            ) : (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor={`${formId}-pasted`} className="text-xs">
                  API key
                </Label>
                <Input
                  id={`${formId}-pasted`}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="geo_…"
                  value={pastedKey}
                  onChange={(event) => setPastedKey(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">Kept in memory on this page only; never stored.</p>
              </div>
            )}
            {authError && (
              <p role="alert" className="text-xs text-destructive">
                {authError}
              </p>
            )}
          </fieldset>

          <Button type="submit" disabled={pending} className="self-start">
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            Send request
          </Button>
        </form>

        <div className="flex min-w-0 flex-col gap-4 p-4">
          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Request</p>
            <div className="mt-2 overflow-x-auto rounded-lg border bg-code px-3 py-2 font-mono text-xs whitespace-nowrap">
              <span className="font-semibold text-primary">{endpoint.method}</span>{" "}
              <span data-testid="request-line">{path}</span>
            </div>
            <div className="relative mt-2 rounded-lg border bg-code">
              <pre className="overflow-x-auto p-3 pr-10 font-mono text-xs leading-relaxed" data-testid="curl">
                {curl}
              </pre>
              <CopyButton text={curl} label="Copy cURL" className="absolute top-1 right-1" />
            </div>
          </div>

          <div>
            <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Response</p>
            <div aria-live="polite" className="mt-2">
              {result === null ? (
                <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
                  <KeyRound className="mx-auto mb-2 size-4" aria-hidden="true" />
                  Send a request to see the response.
                </p>
              ) : result.kind === "error" ? (
                <p role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                  {result.message}
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                    <span
                      className={cn("rounded-md px-2 py-0.5 font-mono font-semibold", statusTone(result.status))}
                      data-testid="status-line"
                    >
                      {statusLine(result.status, result.statusText)}
                    </span>
                    <span className="text-muted-foreground">{result.elapsedMs} ms</span>
                    {result.rateLimit && (
                      <span className="font-mono text-muted-foreground">
                        {result.rateLimit.remaining}/{result.rateLimit.limit} left
                      </span>
                    )}
                  </div>
                  {(result.rateLimit || result.requestId) && (
                    <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-[11px] text-muted-foreground">
                      {result.rateLimit && (
                        <>
                          <dt>X-RateLimit-Limit</dt>
                          <dd>{result.rateLimit.limit}</dd>
                          <dt>X-RateLimit-Remaining</dt>
                          <dd>{result.rateLimit.remaining}</dd>
                          <dt>X-RateLimit-Reset</dt>
                          <dd>{result.rateLimit.reset}</dd>
                        </>
                      )}
                      {result.requestId && (
                        <>
                          <dt>X-Request-ID</dt>
                          <dd className="truncate">{result.requestId}</dd>
                        </>
                      )}
                    </dl>
                  )}
                  <pre
                    className="max-h-96 overflow-auto rounded-lg border bg-code p-3 font-mono text-xs leading-relaxed"
                    data-testid="response-body"
                  >
                    {result.body}
                  </pre>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
