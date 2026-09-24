"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback } from "react";
import { safeNextPath } from "@/lib/auth-errors";

/** Refreshes the header's session state and goes to the requested page. */
export function useAfterSignIn() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  return useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    router.replace(safeNextPath(searchParams.get("next")));
    router.refresh();
  }, [queryClient, router, searchParams]);
}
