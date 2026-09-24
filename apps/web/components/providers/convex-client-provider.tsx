"use client";

import { ConvexAuthNextjsProvider } from "@convex-dev/auth/nextjs";
import { ConvexReactClient } from "convex/react";
import type { ReactNode } from "react";
import { publicConfig } from "@/lib/config";

const convex = new ConvexReactClient(publicConfig.convexUrl);

/** Live Convex queries for the developer console (auth pages and dashboard). */
export function ConvexClientProvider({ children }: { children: ReactNode }) {
  return <ConvexAuthNextjsProvider client={convex}>{children}</ConvexAuthNextjsProvider>;
}
