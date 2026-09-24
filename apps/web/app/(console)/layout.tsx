import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import { ConvexClientProvider } from "@/components/providers/convex-client-provider";

/**
 * Developer console (sign-in pages and dashboard). Only this part of the site
 * loads the Convex client; public pages stay static.
 *
 * Token storage: the default (localStorage) holds only the short-lived access
 * JWT; the refresh token stays in an httpOnly cookie managed by proxy.ts.
 * storage="inMemory" is avoided: in @convex-dev/auth 0.0.95 it reads from a
 * stale snapshot, so token refreshes fail and the socket signs out.
 */
export default function ConsoleLayout({ children }: LayoutProps<"/">) {
  return (
    <ConvexAuthNextjsServerProvider>
      <ConvexClientProvider>
        <div className="flex min-h-dvh flex-col">{children}</div>
      </ConvexClientProvider>
    </ConvexAuthNextjsServerProvider>
  );
}
