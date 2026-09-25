import type { ReactNode } from "react";
import en from "@/messages/en.json";
import { I18nProvider } from "@/lib/i18n/provider";
import type { Messages } from "@/lib/i18n/types";

/** Wraps a tree with the English dictionary for component tests. */
export function TestI18n({ children }: { children: ReactNode }) {
  return (
    <I18nProvider locale="en" messages={en as Messages}>
      {children}
    </I18nProvider>
  );
}
