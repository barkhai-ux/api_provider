"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function CopyButton({ text, label = "Copy code", className }: { text: string; label?: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      onClick={copy}
      aria-label={copied ? "Copied" : label}
      className={cn("text-muted-foreground", className)}
    >
      {/* Both icons stay mounted and cross-fade; blur hides the swap. */}
      <span className="relative size-4">
        <Copy
          className={cn(
            "absolute inset-0 transition-[opacity,scale,filter] duration-200 ease-out",
            copied && "scale-50 opacity-0 blur-[2px]",
          )}
        />
        <Check
          className={cn(
            "absolute inset-0 text-success transition-[opacity,scale,filter] duration-200 ease-out",
            !copied && "scale-50 opacity-0 blur-[2px]",
          )}
        />
      </span>
    </Button>
  );
}
