import "server-only";

import { createHighlighterCore, type HighlighterCore } from "shiki/core";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";

export type CodeLanguage = "bash" | "javascript" | "typescript" | "python" | "json" | "dart" | "http";

let highlighter: Promise<HighlighterCore> | undefined;

/** One shared highlighter with only the languages the docs use. Runs at build/render time on the server. */
function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [
      import("shiki/langs/bash.mjs"),
      import("shiki/langs/javascript.mjs"),
      import("shiki/langs/typescript.mjs"),
      import("shiki/langs/python.mjs"),
      import("shiki/langs/json.mjs"),
      import("shiki/langs/dart.mjs"),
      import("shiki/langs/http.mjs"),
    ],
    engine: createJavaScriptRegexEngine(),
  });
  return highlighter;
}

// Pages render per request (for the CSP nonce), and the code samples are fixed
// strings, so each result is computed once. Bounded in case of many variants.
const cache = new Map<string, Promise<string>>();
const MAX_CACHE_ENTRIES = 500;

/** Highlighted HTML using CSS variables for light and dark themes (see globals.css). */
export function highlight(code: string, lang: CodeLanguage): Promise<string> {
  const key = `${lang}\u0000${code}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const result = getHighlighter().then((instance) =>
    instance.codeToHtml(code.trimEnd(), {
      lang,
      themes: { light: "github-light", dark: "github-dark" },
      defaultColor: false,
    }),
  );
  if (cache.size >= MAX_CACHE_ENTRIES) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  result.catch(() => cache.delete(key));
  return result;
}
