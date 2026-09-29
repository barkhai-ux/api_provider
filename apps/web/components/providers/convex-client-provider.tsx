"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import { type ReactNode, useEffect } from "react";
import { publicConfig } from "@/lib/config";

const convex = new ConvexReactClient(publicConfig.convexUrl);

/** Live Convex queries for the developer console (auth pages and dashboard). */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  useEffect(() => {
    // Remove credentials left by releases that used Convex Auth's default
    // localStorage mode. Current credentials are held only in memory/cookies.
    try {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("__convexAuth")) window.localStorage.removeItem(key);
      }
    } catch {
      // Storage may be disabled by the browser; no persisted values exist then.
    }
  }, []);

  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
