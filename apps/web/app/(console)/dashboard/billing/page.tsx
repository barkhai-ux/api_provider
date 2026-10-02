import type { Metadata } from "next";
import { BillingView } from "@/components/dashboard/billing-view";

export const metadata: Metadata = { title: "Billing" };

export default async function BillingPage({ searchParams }: PageProps<"/dashboard/billing">) {
  const { plan } = await searchParams;
  const selected = plan === "starter" || plan === "essentials" || plan === "pro" ? plan : undefined;
  return <BillingView selectedPlan={selected} />;
}
