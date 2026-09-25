"use client";

import { Languages } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { LOCALE_COOKIE, LOCALE_COOKIE_MAX_AGE, LOCALE_LABELS, type Locale } from "@/lib/i18n/config";
import { useI18n, useT } from "@/lib/i18n/provider";
import { cn } from "@/lib/utils";

// Module scope so the React compiler does not treat the cookie write as state.
function writeLocaleCookie(next: Locale): void {
  document.cookie = `${LOCALE_COOKIE}=${next};path=/;max-age=${LOCALE_COOKIE_MAX_AGE};samesite=lax`;
}

/** One-click language switch. With two locales, clicking flips to the other and
 * refreshes the server-rendered content immediately. */
export function LanguageToggle({ className }: { className?: string }) {
  const { locale } = useI18n();
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next: Locale = locale === "en" ? "mn" : "en";

  function toggle() {
    writeLocaleCookie(next);
    startTransition(() => router.refresh());
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={pending}
      aria-label={t("language.switchTo", { lang: LOCALE_LABELS[next] })}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-sm font-semibold text-foreground/75 transition-colors hover:text-foreground disabled:opacity-60",
        className,
      )}
    >
      <Languages className="size-4" aria-hidden="true" />
      <span>{LOCALE_LABELS[next]}</span>
    </button>
  );
}
