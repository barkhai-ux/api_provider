"use client";

import { useQuery } from "@tanstack/react-query";

export type SessionState =
  | { authenticated: false }
  | { authenticated: true; user: { name: string; email: string } };

/**
 * Whether a developer is signed in. Read from a small route handler so public
 * pages can stay static and do not need the Convex client.
 */
export function useSession() {
  return useQuery<SessionState>({
    queryKey: ["session"],
    queryFn: async ({ signal }) => {
      const response = await fetch("/api/session", { signal, cache: "no-store" });
      if (!response.ok) {
        await response.body?.cancel();
        return { authenticated: false };
      }
      return (await response.json()) as SessionState;
    },
    staleTime: 60_000,
  });
}
