import type { Messages } from "./types";

/** Resolves a dot path ("nav.map") in the messages, interpolating {vars}. */
export function createTranslator(messages: Messages) {
  return function t(path: string, vars?: Record<string, string | number>): string {
    const value = path.split(".").reduce<unknown>((node, key) => {
      if (node && typeof node === "object" && key in node) return (node as Record<string, unknown>)[key];
      return undefined;
    }, messages);
    if (typeof value !== "string") return path; // visible marker for a missing key
    return vars ? value.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`)) : value;
  };
}

export type Translator = ReturnType<typeof createTranslator>;
