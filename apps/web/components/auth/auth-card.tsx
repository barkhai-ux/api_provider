import type { ReactNode } from "react";

/** Frameless auth form block: large heading, form, footer link row. */
export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string;
  description?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="stagger stagger-quick w-full max-w-sm [--stagger-step:60ms]">
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      {description && <p className="mt-2 text-muted-foreground">{description}</p>}
      <div className="mt-8">{children}</div>
      {footer && <div className="mt-8 border-t pt-6 text-sm text-muted-foreground">{footer}</div>}
    </div>
  );
}
