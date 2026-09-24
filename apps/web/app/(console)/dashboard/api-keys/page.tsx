import type { Metadata } from "next";
import { Suspense } from "react";
import { ApiKeysView } from "@/components/dashboard/api-keys-view";

export const metadata: Metadata = { title: "API Keys" };

export default function ApiKeysPage() {
  return (
    <Suspense>
      <ApiKeysView />
    </Suspense>
  );
}
