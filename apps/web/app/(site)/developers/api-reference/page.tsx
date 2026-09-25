import type { Metadata } from "next";
import Link from "next/link";
import { withInlineCode } from "@/components/docs/error-table";
import { C, DocTable, Endpoint, MethodBadge } from "@/components/docs/prose";
import type { PlaygroundEndpointId } from "@/components/playground/endpoints";
import { Playground } from "@/components/playground/playground";
import { publicConfig } from "@/lib/config";
import {
  constraints,
  describeType,
  errorResponses,
  flattenSchema,
  openApi,
  publicOperations,
  resolve,
  successSchema,
} from "@/lib/docs/openapi";

export const metadata: Metadata = {
  title: "API reference",
  description: "Every endpoint, parameter and response field of the public API, with an in-browser playground.",
};

const PLAYGROUND_BY_PATH: Record<string, PlaygroundEndpointId> = {
  "/v1/geocode": "geocode",
  "/v1/route": "route",
};

const DOCS_BY_PATH: Record<string, string> = {
  "/v1/geocode": "/developers/docs/geocoding",
  "/v1/route": "/developers/docs/routing",
};

export default function ApiReferencePage() {
  const operations = publicOperations();
  const apiUrl = publicConfig.apiUrl;

  return (
    <div className="mx-auto flex w-full max-w-7xl gap-10 px-4 py-8 sm:px-6 lg:py-12">
      <aside className="sticky top-24 hidden h-fit w-56 shrink-0 lg:block" aria-label="Endpoints">
        <p className="mb-3 text-xs font-medium tracking-wide text-muted-foreground uppercase">Endpoints</p>
        <ul className="flex flex-col gap-1 text-sm">
          {operations.map((operation) => (
            <li key={operation.operationId}>
              <a
                href={`#${operation.operationId}`}
                className="flex items-center gap-2 rounded-md px-2 py-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                <span className="font-mono text-[10px] font-semibold text-primary">{operation.method}</span>
                <span className="truncate font-mono text-xs">{operation.path}</span>
              </a>
            </li>
          ))}
        </ul>
        <div className="mt-6 border-t pt-4 text-sm">
          <Link href="/developers/docs" className="text-muted-foreground hover:text-foreground">
            ← Documentation
          </Link>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-primary">Reference · {openApi.info.version}</p>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">API reference</h1>
          <p className="mt-3 text-lg leading-8 text-muted-foreground">
            The public <C>/v1</C> API, generated from its OpenAPI schema. Every request needs an API key in the{" "}
            <C>Authorization: Bearer</C> header; every error uses the{" "}
            <Link href="/developers/docs/errors" className="font-medium text-primary underline underline-offset-4">
              standard error envelope
            </Link>
            .
          </p>
          <dl className="mt-6 grid gap-3 rounded-lg border p-4 text-sm sm:grid-cols-[auto_minmax(0,1fr)]">
            <dt className="text-muted-foreground">Base URL</dt>
            <dd className="font-mono break-all">{apiUrl}</dd>
            <dt className="text-muted-foreground">OpenAPI</dt>
            <dd className="flex flex-wrap gap-x-4 gap-y-1">
              <a className="font-mono text-primary underline underline-offset-4" href={`${apiUrl}/openapi.json`}>
                /openapi.json
              </a>
              <a className="font-mono text-primary underline underline-offset-4" href={`${apiUrl}/docs`}>
                /docs
              </a>
              <a className="font-mono text-primary underline underline-offset-4" href={`${apiUrl}/redoc`}>
                /redoc
              </a>
            </dd>
          </dl>
        </header>

        <nav aria-label="Endpoints" className="mt-6 flex flex-wrap gap-2 lg:hidden">
          {operations.map((operation) => (
            <a
              key={operation.operationId}
              href={`#${operation.operationId}`}
              className="rounded-md border px-2.5 py-1 font-mono text-xs text-muted-foreground hover:text-foreground"
            >
              {operation.path}
            </a>
          ))}
        </nav>

        {operations.map((operation) => {
          const response = successSchema(operation);
          const responseName = response?.$ref?.split("/").at(-1);
          const playground = PLAYGROUND_BY_PATH[operation.path];
          const guide = DOCS_BY_PATH[operation.path];
          return (
            <section
              key={operation.operationId}
              id={operation.operationId}
              aria-labelledby={`${operation.operationId}-title`}
              className="mt-14 scroll-mt-20 border-t pt-10"
            >
              <div className="flex flex-wrap items-center gap-2">
                <MethodBadge method={operation.method} />
                {operation.tags?.map((tag) => (
                  <span key={tag} className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                    {tag}
                  </span>
                ))}
              </div>
              <h2 id={`${operation.operationId}-title`} className="mt-3 text-2xl font-semibold tracking-tight">
                {operation.summary}
              </h2>
              <Endpoint method={operation.method} path={operation.path} />
              {operation.description && (
                <p className="mt-4 max-w-3xl leading-7 text-foreground/90">{withInlineCode(operation.description)}</p>
              )}
              {guide && (
                <p className="mt-2 text-sm">
                  <Link href={guide} className="font-medium text-primary underline underline-offset-4">
                    Read the guide
                  </Link>
                </p>
              )}

              <h3 className="mt-8 text-base font-semibold">Query parameters</h3>
              <DocTable
                caption={`${operation.summary} parameters`}
                columns={[
                  { header: "Name", className: "w-36" },
                  { header: "Type", className: "w-40" },
                  { header: "Constraints", className: "w-44" },
                  { header: "Description" },
                ]}
                rows={(operation.parameters ?? []).map((parameter) => [
                  <span key="n" className="flex flex-col gap-1">
                    <code className="font-mono text-[13px] font-medium">{parameter.name}</code>
                    <span className={parameter.required ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>
                      {parameter.required ? "required" : "optional"}
                    </span>
                  </span>,
                  <code key="t" className="font-mono text-[13px] text-muted-foreground">
                    {describeType(parameter.schema)}
                  </code>,
                  <span key="c" className="text-muted-foreground">
                    {constraints(parameter.schema).join(", ") || "—"}
                  </span>,
                  <span key="d">{parameter.schema.description ?? resolve(parameter.schema).description ?? ""}</span>,
                ])}
              />

              {response && (
                <>
                  <h3 className="mt-8 text-base font-semibold">
                    Response <span className="font-normal text-muted-foreground">200 · {responseName}</span>
                  </h3>
                  <DocTable
                    caption={`${operation.summary} response fields`}
                    columns={[
                      { header: "Field", className: "w-64" },
                      { header: "Type", className: "w-40" },
                      { header: "Description" },
                    ]}
                    rows={flattenSchema(response).map((row) => [
                      <span key="f" className="flex flex-col gap-1">
                        <code className="font-mono text-[13px] font-medium break-all">{row.name}</code>
                        {!row.required && <span className="text-xs text-muted-foreground">optional</span>}
                      </span>,
                      <code key="t" className="font-mono text-[13px] break-words text-muted-foreground">
                        {row.type}
                      </code>,
                      <span key="d">{withInlineCode(row.description)}</span>,
                    ])}
                  />
                </>
              )}

              <h3 className="mt-8 text-base font-semibold">Errors</h3>
              <DocTable
                caption={`${operation.summary} errors`}
                columns={[
                  { header: "Status", className: "w-20" },
                  { header: "Code", className: "w-56" },
                  { header: "Example message" },
                ]}
                rows={errorResponses(operation).map((error) => [
                  <span key="s" className="font-mono">{error.status}</span>,
                  <C key="c">{error.code}</C>,
                  <span key="m" className="text-muted-foreground">{error.message}</span>,
                ])}
              />

              {playground && (
                <>
                  <h3 className="mt-8 text-base font-semibold">Try it</h3>
                  <Playground endpoint={playground} />
                </>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
