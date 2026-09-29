import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";

/**
 * Developer console (sign-in pages and dashboard). Only this part of the site
 * loads the Convex client; public pages stay static.
 *
 * Keep the browser-side token copy in memory. The authoritative refresh token
 * also lives in an httpOnly cookie managed by proxy.ts, and the package patch
 * at the repository root fixes @convex-dev/auth 0.0.95's stale memory store.
 */
export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <ConvexAuthNextjsServerProvider storage="inMemory">
      <ConvexClientProvider>
        <div className="flex min-h-dvh flex-col">{children}</div>
      </ConvexClientProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
