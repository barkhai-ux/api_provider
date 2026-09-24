import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { OverviewView } from "@/components/dashboard/overview-view";
import { publicConfig } from "@/lib/config";

export const metadata: Metadata = { title: "Dashboard" };

export default function DashboardPage() {
  const quickstart = (
    <CodeBlock
      title="Your first request"
      lang="bash"
      code={`curl "${publicConfig.apiUrl}/v1/geocode?q=Ulaanbaatar" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`}
    />
  );
  return <OverviewView quickstart={quickstart} />;
}
