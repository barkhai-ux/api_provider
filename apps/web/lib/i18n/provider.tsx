"use client";

import { createContext, useContext, useMemo, type ReactNode } from "react";
import type { Locale } from "./config";
import { createTranslator, type Translator } from "./translate";
import type { Messages } from "./types";

type I18nValue = { locale: Locale; t: Translator };
const I18nContext = createContext<I18nValue | null>(null);

/** Fed by the root layout with the request's locale and messages. */
export function I18nProvider({ locale, messages, children }: { locale: Locale; messages: Messages; children: ReactNode }) {
  const value = useMemo<I18nValue>(() => ({ locale, t: createTranslator(messages) }), [locale, messages]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (value === null) throw new Error("useI18n must be used within I18nProvider");
  return value;
}

/** Shorthand: const t = useT(). */
export function useT(): Translator {
  return useI18n().t;
}
