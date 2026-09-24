"use client";

import { TriangleAlert } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function DashboardError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div role="alert" className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
      <TriangleAlert className="size-8 text-warning" aria-hidden="true" />
      <h1 className="text-lg font-semibold">This page could not load</h1>
      <p className="text-sm text-muted-foreground">
        Your session may have ended, or the console is temporarily unavailable.
      </p>
      <div className="flex gap-2">
        <Button onClick={reset}>Try again</Button>
        <Button asChild variant="outline">
          <Link href="/login?next=/dashboard">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}
