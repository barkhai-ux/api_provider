import { ArrowRight, Check, Globe2, Sparkles } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Reveal } from "@/components/motion/reveal";
import { Button } from "@/components/ui/button";
import { getT } from "@/lib/i18n/server";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: "Pricing",
  description: "Simple monthly plans for Mongolia geocoding and routing APIs.",
};

const PLANS = [
  {
    id: "starter",
    price: "$50",
    requests: "10,000",
    rate: "100",
    popular: false,
    features: ["geocoding", "reverseGeocoding", "routing", "communitySupport"],
  },
  {
    id: "essentials",
    price: "$137.50",
    requests: "100,000",
    rate: "500",
    popular: true,
    features: ["everythingStarter", "higherLimits", "usageAnalytics", "emailSupport"],
  },
  {
    id: "pro",
    price: "$600",
    requests: "500,000",
    rate: "2,000",
    popular: false,
    features: ["everythingEssentials", "priorityRouting", "multipleProjects", "prioritySupport"],
  },
  {
    id: "enterprise",
    price: null,
    requests: null,
    rate: null,
    popular: false,
    features: ["customVolume", "dedicatedCapacity", "serviceAgreement", "technicalContact"],
  },
] as const;

export default async function PricingPage() {
  const t = await getT();

  return (
    <div className="theme-dark overflow-x-clip bg-background text-foreground">
      <section className="relative border-b">
        <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
          <div className="bg-street-grid absolute inset-0" />
          <div className="absolute top-[-220px] left-1/2 h-[520px] w-[760px] -translate-x-1/2 rounded-full bg-[oklch(0.5_0.2_265/0.24)] blur-3xl" />
        </div>

        <div className="relative mx-auto max-w-[1400px] px-4 pt-20 pb-14 text-center sm:px-6 lg:px-8 lg:pt-28 lg:pb-20">
          <div className="stagger mx-auto max-w-3xl">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-bold tracking-[0.12em] text-primary uppercase">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("pricing.eyebrow")}
            </span>
            <h1 className="mt-6 text-[44px] leading-[1.04] font-bold sm:text-6xl lg:text-[68px]">
              {t("pricing.title")}
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-muted-foreground sm:text-xl">
              {t("pricing.subtitle")}
            </p>
          </div>
        </div>
      </section>

      <section aria-labelledby="plans-heading" className="mx-auto max-w-[1400px] px-4 py-16 sm:px-6 lg:px-8 lg:py-24">
        <h2 id="plans-heading" className="sr-only">
          {t("pricing.plansHeading")}
        </h2>
        <div className="grid items-stretch gap-5 md:grid-cols-2 xl:grid-cols-4">
          {PLANS.map((plan, index) => (
            <Reveal key={plan.id} delay={index * 0.06} className="h-full">
              <article
                className={cn(
                  "relative flex h-full flex-col overflow-hidden rounded-2xl border bg-card",
                  plan.popular && "border-primary shadow-[0_18px_70px_-28px_var(--glow)] xl:-translate-y-3",
                )}
              >
                <div
                  className={cn(
                    "flex min-h-11 items-center justify-center border-b px-5 py-3 text-center text-sm font-bold",
                    plan.popular ? "border-primary bg-primary text-primary-foreground" : "bg-secondary/45 text-foreground",
                  )}
                >
                  {plan.popular ? t("pricing.mostPopular") : t(`pricing.plans.${plan.id}.banner`)}
                </div>

                <div className="flex flex-1 flex-col p-6">
                  <div className="min-h-41">
                    <h3 className="text-3xl font-bold">{t(`pricing.plans.${plan.id}.name`)}</h3>
                    <div className="mt-5 flex min-h-12 items-end gap-1.5">
                      {plan.price ? (
                        <>
                          <span className="text-4xl font-bold tracking-tight">{plan.price}</span>
                          <span className="pb-1 text-sm text-muted-foreground">{t("pricing.perMonth")}</span>
                        </>
                      ) : (
                        <span className="text-3xl font-bold">{t("pricing.custom")}</span>
                      )}
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
                      {t(`pricing.plans.${plan.id}.description`)}
                    </p>
                  </div>

                  <div className="mt-6 border-y py-5">
                    <div className="flex items-start gap-3">
                      <Globe2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                      <div>
                        <p className="font-bold">
                          {plan.requests ? t("pricing.requests", { count: plan.requests }) : t("pricing.customRequests")}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {plan.rate ? t("pricing.rateLimit", { count: plan.rate }) : t("pricing.customRateLimit")}
                        </p>
                      </div>
                    </div>
                  </div>

                  <ul className="mt-6 flex flex-1 flex-col gap-3.5">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex gap-3 text-sm leading-snug text-foreground/85">
                        <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary">
                          <Check className="size-3.5" strokeWidth={2.5} aria-hidden="true" />
                        </span>
                        {t(`pricing.features.${feature}`)}
                      </li>
                    ))}
                  </ul>

                  <Button
                    asChild
                    size="xl"
                    variant={plan.popular ? "default" : "contrast"}
                    className="mt-8 w-full"
                  >
                    <Link href="/register">
                      {plan.id === "enterprise" ? t("pricing.contactUs") : t("pricing.getStarted")}
                      <ArrowRight aria-hidden="true" />
                    </Link>
                  </Button>
                </div>
              </article>
            </Reveal>
          ))}
        </div>

        <p className="mt-8 text-center text-sm text-muted-foreground">{t("pricing.note")}</p>
      </section>

      <section className="relative overflow-hidden border-t">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(60%_100%_at_50%_100%,var(--glow),transparent_70%)]"
        />
        <Reveal className="relative mx-auto flex max-w-3xl flex-col items-center px-4 py-20 text-center lg:py-24">
          <h2 className="text-3xl font-bold sm:text-5xl">{t("pricing.cta.title")}</h2>
          <p className="mt-5 text-lg text-muted-foreground">{t("pricing.cta.subtitle")}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Button asChild size="xl">
              <Link href="/register">{t("pricing.getStarted")}</Link>
            </Button>
            <Button asChild size="xl" variant="contrast">
              <Link href="/developers/docs">{t("pricing.cta.readDocs")}</Link>
            </Button>
          </div>
        </Reveal>
      </section>
    </div>
  );
}
