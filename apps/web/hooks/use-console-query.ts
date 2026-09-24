"use client";

import { useConvexAuth, useQuery } from "convex/react";
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server";
import { useState } from "react";

/**
 * `useQuery` for console data that needs a signed-in developer. It waits for
 * Convex Auth to restore the session (the query would otherwise run
 * unauthenticated and throw), then subscribes to live updates.
 */
export function useConsoleQuery<Query extends FunctionReference<"query">>(
  query: Query,
  args: FunctionArgs<Query>,
): FunctionReturnType<Query> | undefined {
  const { isAuthenticated } = useConvexAuth();
  // useQuery's rest-args signature cannot express "args or skip" generically.
  const run = useQuery as (q: Query, a: FunctionArgs<Query> | "skip") => FunctionReturnType<Query> | undefined;
  return run(query, isAuthenticated ? args : "skip");
}

/**
 * Keeps the last loaded value while new arguments load, so charts hold their
 * frame (at reduced opacity) instead of flashing a skeleton.
 */
export function useStableValue<T>(value: T | undefined): { value: T | undefined; stale: boolean } {
  const [last, setLast] = useState<T | undefined>(value);
  // Adjusting state while rendering is React's documented pattern for
  // remembering a previous value; it re-renders before committing.
  if (value !== undefined && value !== last) setLast(value);
  return { value: value ?? last, stale: value === undefined && last !== undefined };
}
