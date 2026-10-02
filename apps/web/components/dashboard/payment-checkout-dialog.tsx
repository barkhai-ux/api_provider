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

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function string(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readPaymentAction(value: unknown): { qrText: string | null; qrImage: string | null; redirectUrl: string | null } {
  const root = object(value);
  const qr = object(root.qr ?? root.qpay ?? root.data ?? root.display ?? value);
  const qrText = string(qr.text ?? qr.qr_text ?? qr.qrText);
  const image = string(qr.image_url ?? qr.qr_image ?? qr.qrImage ?? qr.image);
  const qrImage = image && (/^https:\/\//i.test(image) || /^data:image\/(png|jpeg|webp);base64,/i.test(image))
    ? image : image && /^[A-Za-z\d+/=]+$/.test(image) ? `data:image/png;base64,${image}` : null;
  const redirect = string(object(root.redirect_to_url).url ?? qr.url);
  const redirectUrl = redirect && /^https:\/\//i.test(redirect) ? redirect : null;
  return { qrText, qrImage, redirectUrl };
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
              {payment.qrText ? (
                <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border/70"><PaymentQr value={payment.qrText} /></div>
              ) : payment.qrImage ? (
                <div className="rounded-2xl bg-white p-3 shadow-sm ring-1 ring-border/70">
                  <img src={payment.qrImage} alt={t("billing.qrAlt")} className="size-52 object-contain" />
                </div>
              ) : (
                <p className="rounded-lg bg-muted p-4 text-center text-muted-foreground">{t("billing.noPaymentInstructions")}</p>
              )}
              <p className="max-w-64 text-center text-sm text-muted-foreground">{t("billing.scanInstruction")}</p>
            </div>
            {payment.redirectUrl && (
              <Button variant="outline" asChild>
                <a href={payment.redirectUrl} target="_blank" rel="noopener noreferrer">{t("billing.openPaymentPage")}</a>
              </Button>
            )}
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
