import "server-only";
import { cookies } from "next/headers";
import en from "@/messages/en.json";
import mn from "@/messages/mn.json";
import { DEFAULT_LOCALE, LOCALE_COOKIE, type Locale, isLocale } from "./config";
import { createTranslator } from "./translate";
import type { Messages } from "./types";

const DICTIONARIES: Record<Locale, Messages> = { en: en as Messages, mn: mn as Messages };

/** The request's locale, from the cookie set by the language toggle. */
export async function getLocale(): Promise<Locale> {
  const value = (await cookies()).get(LOCALE_COOKIE)?.value;
  return isLocale(value) ? value : DEFAULT_LOCALE;
}

export function getMessages(locale: Locale): Messages {
  return DICTIONARIES[locale];
}

/** A translator for a Server Component. */
export async function getT() {
  return createTranslator(getMessages(await getLocale()));
}
