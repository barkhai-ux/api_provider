import { Info, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** Small, typography-focused building blocks for documentation pages. */

export function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="group mt-12 scroll-mt-24 border-b pb-2 text-xl font-semibold tracking-tight first:mt-0">
      <a href={`#${id}`} className="no-underline outline-offset-4">
        {children}
        <span aria-hidden="true" className="ml-2 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100">
          #
        </span>
      </a>
    </h2>
  );
}

export function H3({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className="mt-8 scroll-mt-24 text-base font-semibold tracking-tight">
      {children}
    </h3>
  );
}

export function P({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("mt-4 leading-7 text-foreground/90", className)}>{children}</p>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <p className="mt-3 text-lg leading-8 text-muted-foreground">{children}</p>;
}

export function C({ children }: { children: ReactNode }) {
  return (
    <code className="rounded-md border bg-muted/60 px-1.5 py-0.5 font-mono text-[0.85em] break-words">{children}</code>
  );
}

export function A({ href, children }: { href: string; children: ReactNode }) {
  const className = "font-medium text-primary underline underline-offset-4 hover:no-underline";
  if (href.startsWith("/") || href.startsWith("#")) {
    return (
      <Link href={href} className={className}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} className={className} rel="noreferrer">
      {children}
    </a>
  );
}

export function UL({ children }: { children: ReactNode }) {
  return <ul className="mt-4 ml-5 list-disc space-y-2 leading-7 text-foreground/90 marker:text-muted-foreground">{children}</ul>;
}

export function OL({ children }: { children: ReactNode }) {
  return <ol className="mt-4 ml-5 list-decimal space-y-2 leading-7 text-foreground/90 marker:text-muted-foreground">{children}</ol>;
}

export function Callout({
  children,
  title,
  tone = "info",
}: {
  children: ReactNode;
  title?: string;
  tone?: "info" | "warning";
}) {
  const Icon = tone === "warning" ? TriangleAlert : Info;
  return (
    <div
      className={cn(
        "mt-6 flex gap-3 rounded-lg border p-4 text-sm leading-6",
        tone === "warning" ? "border-warning/40 bg-warning/5" : "border-primary/25 bg-primary/5",
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("mt-0.5 size-4 shrink-0", tone === "warning" ? "text-warning" : "text-primary")}
      />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn("text-foreground/85", title && "mt-1")}>{children}</div>
      </div>
    </div>
  );
}

export function MethodBadge({ method }: { method: string }) {
  return (
    <span className="inline-flex h-6 items-center rounded-md bg-primary/10 px-2 font-mono text-xs font-semibold text-primary">
      {method}
    </span>
  );
}

/** "GET /v1/geocode" line shown at the top of endpoint pages. */
export function Endpoint({ method, path }: { method: string; path: string }) {
  return (
    <div className="not-prose mt-6 flex min-w-0 items-center gap-3 overflow-x-auto rounded-lg border bg-code px-4 py-3">
      <MethodBadge method={method} />
      <code className="font-mono text-sm whitespace-nowrap">{path}</code>
    </div>
  );
}

export type TableColumn = { header: string; className?: string };

/** Responsive table: scrolls horizontally inside its own box on narrow screens. */
export function DocTable({ columns, rows, caption }: { columns: TableColumn[]; rows: ReactNode[][]; caption?: string }) {
  return (
    <div className="mt-6 overflow-x-auto rounded-lg border">
      <table className="w-full min-w-[560px] border-collapse text-left text-sm">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead className="bg-muted/50">
          <tr>
            {columns.map((column) => (
              <th key={column.header} scope="col" className={cn("px-4 py-2.5 font-medium", column.className)}>
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, index) => (
            <tr key={index} className="border-t align-top">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className="px-4 py-3 leading-6 text-foreground/90">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export type ParamRow = {
  name: string;
  type: string;
  required?: boolean;
  description: ReactNode;
};

export function ParamTable({ params, caption = "Parameters" }: { params: ParamRow[]; caption?: string }) {
  return (
    <DocTable
      caption={caption}
      columns={[{ header: "Name", className: "w-40" }, { header: "Type", className: "w-32" }, { header: "Description" }]}
      rows={params.map((param) => [
        <span key="name" className="flex flex-col gap-1">
          <code className="font-mono text-[13px] font-medium">{param.name}</code>
          <span className={cn("text-xs", param.required ? "text-destructive" : "text-muted-foreground")}>
            {param.required ? "required" : "optional"}
          </span>
        </span>,
        <code key="type" className="font-mono text-[13px] text-muted-foreground">
          {param.type}
        </code>,
        param.description,
      ])}
    />
  );
}

export type FieldRow = { name: string; type: string; description: ReactNode };

export function FieldTable({ fields, caption = "Response fields" }: { fields: FieldRow[]; caption?: string }) {
  return (
    <DocTable
      caption={caption}
      columns={[{ header: "Field", className: "w-56" }, { header: "Type", className: "w-32" }, { header: "Description" }]}
      rows={fields.map((field) => [
        <code key="name" className="font-mono text-[13px] font-medium break-all">
          {field.name}
        </code>,
        <code key="type" className="font-mono text-[13px] text-muted-foreground">
          {field.type}
        </code>,
        field.description,
      ])}
    />
  );
}
