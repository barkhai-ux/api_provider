import type { ReactNode } from "react";
import { C, DocTable } from "@/components/docs/prose";
import type { ErrorInfo } from "@/lib/docs/errors";

/** Renders `backtick` spans in catalogue text as inline code. */
export function withInlineCode(text: string): ReactNode {
  return text.split(/(`[^`]+`)/g).map((part, index) =>
    part.startsWith("`") && part.endsWith("`") ? <C key={index}>{part.slice(1, -1)}</C> : part,
  );
}

export function ErrorTable({ errors, showAction = true }: { errors: ErrorInfo[]; showAction?: boolean }) {
  return (
    <DocTable
      caption="Errors"
      columns={[
        { header: "Status", className: "w-20" },
        { header: "Code", className: "w-52" },
        { header: "Meaning" },
        ...(showAction ? [{ header: "What to do" }] : []),
      ]}
      rows={errors.map((error) => [
        <span key="s" className="font-mono">{error.status}</span>,
        <C key="c">{error.code}</C>,
        <span key="m">{withInlineCode(error.meaning)}</span>,
        ...(showAction ? [<span key="a">{withInlineCode(error.action)}</span>] : []),
      ])}
    />
  );
}
