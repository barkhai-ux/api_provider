"use client";

/* eslint-disable @next/next/no-img-element */

import type { Id } from "@geo-platform/convex/dataModel";
import { CheckCircle2, LoaderCircle, QrCode } from "lucide-react";
import qrcode from "qrcode-generator";
import { useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useI18n } from "@/lib/i18n/provider";

type Plan = "starter" | "essentials" | "pro";
type Checkout = { paymentId: Id<"payments">; plan: Plan; nextAction: unknown };
type BankLink = { name: string; description: string | null; link: string; logo: string | null };

const BANK_APP_SCHEMES = new Set([
  "ard", "arig", "bogdbank", "capitronbank", "ckbank", "hipay", "khanbank", "mbank", "monpay", "most",
  "nibank", "pass", "payon", "qpaywallet", "socialpay-payment", "sono", "statebankmongolia", "tdbbank",
  "tdbwallet", "tino", "toki", "transbank", "xacbank",
]);

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function safeBankLink(value: unknown): string | null {
  const link = string(value);
  if (!link) return null;
  try {
    return BANK_APP_SCHEMES.has(new URL(link).protocol.slice(0, -1).toLowerCase()) ? link : null;
  } catch { return null; }
}

function readPaymentAction(value: unknown): { qrText: string | null; qrImage: string | null; banks: BankLink[] } {
  const root = object(value);
  const qr = object(root.qr ?? root.qpay ?? root.data ?? root.display ?? value);
  const qrText = string(qr.text ?? qr.qr_text ?? qr.qrText);
  const image = string(qr.image_url ?? qr.qr_image ?? qr.qrImage ?? qr.image);
  const qrImage = image && (/^https:\/\//i.test(image) || /^data:image\/(png|jpeg|webp);base64,/i.test(image))
    ? image : image && /^[A-Za-z\d+/=]+$/.test(image) ? `data:image/png;base64,${image}` : null;
  const banks = Array.isArray(qr.deeplinks) ? qr.deeplinks.flatMap((value): BankLink[] => {
    const bank = object(value);
    const name = string(bank.name);
    const link = safeBankLink(bank.link);
    if (!name || !link) return [];
    const logo = string(bank.logo);
    return [{
      name,
      description: string(bank.description),
      link,
      logo: logo && /^https:\/\//i.test(logo) ? logo : null,
    }];
  }) : [];
  return { qrText, qrImage, banks };
}

function PaymentQr({ value }: { value: string }) {
  const modules = useMemo(() => {
    const code = qrcode(0, "M");
    code.addData(value);
    code.make();
    const size = code.getModuleCount();
    const cells: string[] = [];
    for (let row = 0; row < size; row++) {
      for (let column = 0; column < size; column++) {
        if (code.isDark(row, column)) cells.push(`M${column + 4} ${row + 4}h1v1h-1z`);
      }
    }
    return { size: size + 8, path: cells.join("") };
  }, [value]);

  return (
    <svg viewBox={`0 0 ${modules.size} ${modules.size}`} className="size-52 bg-white" role="img" aria-label="QPay QR code" shapeRendering="crispEdges">
      <rect width={modules.size} height={modules.size} fill="white" />
      <path d={modules.path} fill="black" />
    </svg>
  );
}

export function PaymentCheckoutDialog({ checkout, status, onClose, priceMnt }: {
  checkout: Checkout | null;
  status: string | undefined;
  onClose: () => void;
  priceMnt: number;
}) {
  const { t, locale } = useI18n();
  const payment = readPaymentAction(checkout?.nextAction);
  const succeeded = status === "succeeded";
  const failed = status === "failed";

  return (
    <Dialog open={checkout !== null} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-5 overflow-y-auto rounded-2xl p-6 sm:max-w-[420px]">
        <DialogHeader className="items-center gap-3 pt-2 text-center">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
            {succeeded ? <CheckCircle2 className="size-6" aria-hidden="true" /> : <QrCode className="size-6" aria-hidden="true" />}
          </span>
          <DialogTitle className="text-xl">{succeeded ? t("billing.paymentComplete") : t("billing.dialogTitle")}</DialogTitle>
          <DialogDescription>
            {succeeded ? t("billing.paymentCompleteDescription")
              : failed ? t("billing.paymentFailed")
                : t("billing.dialogDescription", { plan: checkout ? t(`pricing.plans.${checkout.plan}.name`) : "" })}
          </DialogDescription>
        </DialogHeader>

        {succeeded ? (
          <div className="flex flex-col items-center gap-4 pb-2 text-center">
            <Button className="w-full" onClick={onClose}>{t("billing.close")}</Button>
          </div>
        ) : failed ? (
          <Button className="w-full" onClick={onClose}>{t("billing.close")}</Button>
        ) : (
          <div className="flex flex-col gap-5">
            <div className="flex items-center justify-between rounded-xl border bg-muted/35 px-4 py-3">
              <span className="text-sm text-muted-foreground">{checkout ? t(`pricing.plans.${checkout.plan}.name`) : ""}</span>
              <strong className="text-xl">₮{new Intl.NumberFormat(locale === "mn" ? "mn-MN" : "en-US").format(priceMnt)}</strong>
            </div>
            <div className="flex flex-col items-center gap-3 rounded-2xl bg-gradient-to-b from-primary/5 to-muted/60 px-4 py-5">
              {(payment.qrImage || payment.qrText) && (
                <div className={payment.banks.length > 0 ? "hidden flex-col items-center gap-3 md:flex" : "flex flex-col items-center gap-3"}>
                  <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border/70">
                    {payment.qrImage
                      ? <img src={payment.qrImage} alt={t("billing.qrAlt")} className="size-52 object-contain" />
                      : <PaymentQr value={payment.qrText!} />}
                  </div>
                  <p className="max-w-64 text-center text-sm text-muted-foreground">{t("billing.scanInstruction")}</p>
                </div>
              )}
              {payment.banks.length > 0 && (
                <div className="flex w-full flex-col gap-3 md:hidden">
                  <p className="text-center text-sm font-medium">{t("billing.chooseBank")}</p>
                  <div className="grid max-h-[42dvh] grid-cols-2 gap-2 overflow-y-auto pr-1">
                    {payment.banks.map((bank) => (
                      <Button key={`${bank.name}-${bank.link}`} variant="outline" className="h-auto min-h-16 justify-start gap-2 bg-background px-3 py-2" asChild>
                        <a href={bank.link} rel="noopener noreferrer">
                          {bank.logo && <img src={bank.logo} alt="" className="size-8 shrink-0 rounded-lg object-contain" />}
                          <span className="min-w-0 text-left text-xs font-medium leading-tight">{bank.name}</span>
                        </a>
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              {!payment.qrText && !payment.qrImage && payment.banks.length === 0 && (
                <p className="rounded-lg bg-muted p-4 text-center text-muted-foreground">{t("billing.noPaymentInstructions")}</p>
              )}
            </div>
            <div className="flex items-center justify-center gap-2 border-t pt-4 text-center text-sm text-muted-foreground">
              <LoaderCircle className="size-4 animate-spin text-primary" aria-hidden="true" />
              {t("billing.waitingForPayment")}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
