"use client";

import { useId, useState } from "react";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

type Item = { label: string; code: string; html: string };

export function CodeTabsClient({
  items,
  className,
  surfaceClassName,
}: {
  items: Item[];
  className?: string;
  surfaceClassName: string;
}) {
  const [active, setActive] = useState(0);
  const id = useId();
  const current = items[active] ?? items[0];

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const last = items.length - 1;
    const next =
      event.key === "ArrowRight" ? (index === last ? 0 : index + 1)
      : event.key === "ArrowLeft" ? (index === 0 ? last : index - 1)
      : event.key === "Home" ? 0
      : event.key === "End" ? last
      : null;
    if (next === null) return;
    event.preventDefault();
    setActive(next);
    document.getElementById(`${id}-tab-${next}`)?.focus();
  }

  return (
    <div className={cn("not-prose my-4 overflow-hidden rounded-lg border", className)}>
      <div className="flex items-center justify-between border-b bg-muted/40 pr-1.5">
        <div role="tablist" aria-label="Code language" className="flex overflow-x-auto">
          {items.map((item, index) => (
            <button
              key={item.label}
              id={`${id}-tab-${index}`}
              role="tab"
              type="button"
              aria-selected={index === active}
              aria-controls={`${id}-panel`}
              tabIndex={index === active ? 0 : -1}
              onClick={() => setActive(index)}
              onKeyDown={(event) => onKeyDown(event, index)}
              className={cn(
                "h-10 border-b-2 border-transparent px-4 text-xs font-medium whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-offset-[-2px]",
                index === active && "border-primary text-foreground",
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
        {current && <CopyButton text={current.code} />}
      </div>
      {current && (
        <div
          id={`${id}-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-tab-${active}`}
          className={surfaceClassName}
          dangerouslySetInnerHTML={{ __html: current.html }}
        />
      )}
    </div>
  );
}
