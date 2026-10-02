"use client";

import { api } from "@geo-platform/convex/api";
import type { Id } from "@geo-platform/convex/dataModel";
import { useAction, useMutation, useQuery } from "convex/react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n/provider";
import { PaymentCheckoutDialog } from "./payment-checkout-dialog";
import { PageHeader } from "./page-header";

type Plan = "starter" | "essentials" | "pro";
const PLAN_ORDER: Plan[] = ["starter", "essentials", "pro"];
type Checkout = { paymentId: Id<"payments">; plan: Plan; nextAction: unknown };

export function BillingView({ selectedPlan }: { selectedPlan?: Plan | "free" }) {
  const { t, locale } = useI18n();
  const billing = useQuery(api.payments.myBilling, {});
  const startCheckout = useAction(api.payments.startCheckout);
  const refreshPayment = useAction(api.payments.refreshPayment);
  const activateFreeTier = useMutation(api.payments.activateFreeTier);
  const [starting, setStarting] = useState<Plan | null>(null);
  const [activatingFree, setActivatingFree] = useState(false);
  const [checkout, setCheckout] = useState<Checkout | null>(null);
  const [error, setError] = useState("");
  const paymentStatus = useQuery(api.payments.paymentStatus, checkout ? { paymentId: checkout.paymentId } : "skip");
  const paidPayments = billing?.payments ?? [];

  useEffect(() => {
    if (!checkout || paymentStatus !== "pending") return;
    const timer = window.setInterval(() => {
      void refreshPayment({ paymentId: checkout.paymentId }).catch(() => {});
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [checkout, paymentStatus, refreshPayment]);

  async function buy(plan: Plan) {
    setStarting(plan);
    setError("");
    try {
      const checkout = await startCheckout({ plan, requestId: crypto.randomUUID() });
      if (checkout.status === "unavailable") {
        setError(t("billing.paymentUnavailable"));
        setStarting(null);
        return;
      }
      setCheckout({ paymentId: checkout.paymentId, nextAction: checkout.nextAction, plan });
      setStarting(null);
    } catch (cause) {
      console.error("checkout failed", cause);
      setError(t("billing.checkoutError"));
      setStarting(null);
    }
  }

  async function activateFree() {
    setActivatingFree(true);
    setError("");
    try {
      await activateFreeTier({});
    } catch (cause) {
      console.error("free tier activation failed", cause);
      setError(t("billing.freeActivationError"));
    } finally {
      setActivatingFree(false);
    }
  }

  function date(value: number) {
    return new Intl.DateTimeFormat(locale === "mn" ? "mn-MN" : "en-US", { dateStyle: "medium" }).format(value);
  }

  return (
    <>
      <PageHeader title={t("billing.title")} description={t("billing.subtitle")} />
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t("billing.currentPlan")}</CardTitle>
            <CardDescription>
              {billing === undefined ? t("common.loading") : billing.plan
                ? t("billing.activeUntil", { plan: t(`pricing.plans.${billing.plan}.name`), date: date(billing.planExpiresAt!) })
                : billing.freeTier.activated
                  ? t("billing.freeActive", { remaining: billing.freeTier.remaining.toLocaleString(), total: billing.freeTier.total.toLocaleString() })
                  : t("billing.freePlan")}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t("billing.renewalNote")}</p>
          </CardContent>
        </Card>

        <Card className={selectedPlan === "free" ? "border-primary" : undefined}>
          <CardHeader>
            <CardTitle>{t("pricing.plans.free.name")}</CardTitle>
            <CardDescription>{t("pricing.plans.free.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="space-y-2">
              <p className="text-2xl font-bold">₮0</p>
              <p className="text-sm">{t("pricing.freeRequests", { count: "500" })}</p>
              <p className="text-sm text-muted-foreground">{t("pricing.freeRateLimit", { count: "30" })}</p>
            </div>
            <Button className="w-full sm:w-auto" disabled={!billing || activatingFree || billing.freeTier.activated} onClick={() => void activateFree()}>
              {activatingFree ? t("common.loading") : billing?.freeTier.activated ? t("billing.freeActivated") : t("billing.activateFree")}
            </Button>
          </CardContent>
        </Card>

        <div className="grid gap-4 md:grid-cols-3">
          {PLAN_ORDER.map((plan) => (
            <Card key={plan} className={selectedPlan === plan ? "border-primary" : undefined}>
              <CardHeader>
                <CardTitle>{t(`pricing.plans.${plan}.name`)}</CardTitle>
                <CardDescription>{t(`pricing.plans.${plan}.description`)}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <p className="text-2xl font-bold">₮{billing?.priceMnt.toLocaleString() ?? "1,000"}<span className="text-sm font-normal text-muted-foreground"> {t("billing.perPeriod")}</span></p>
                <p className="text-sm">{t("pricing.requests", { count: billing?.plans[plan].monthlyRequests.toLocaleString() ?? "" })}</p>
                <p className="text-sm">{t("pricing.rateLimit", { count: billing?.plans[plan].requestsPerMinute.toLocaleString() ?? "" })}</p>
                <Button disabled={!billing || starting !== null} onClick={() => void buy(plan)} className="w-full">
                  {starting === plan ? t("billing.opening") : t("billing.payWithQpay")}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>

        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}

        <Card>
          <CardHeader>
            <CardTitle>{t("billing.history")}</CardTitle>
          </CardHeader>
          <CardContent>
            {paidPayments.length ? (
              <ul className="divide-y">
                {paidPayments.map((payment) => (
                  <li key={payment.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                    <span>{t(`pricing.plans.${payment.plan}.name`)} · {date(payment.paidAt ?? payment.createdAt)}</span>
                    <span>{t("billing.status.succeeded")}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-muted-foreground">{billing ? t("billing.noPayments") : t("common.loading")}</p>}
          </CardContent>
        </Card>
      </div>
      <PaymentCheckoutDialog
        checkout={checkout}
        status={paymentStatus}
        priceMnt={billing?.priceMnt ?? 1_000}
        onClose={() => setCheckout(null)}
      />
    </>
  );
}
