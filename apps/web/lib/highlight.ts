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

/** Highlighted HTML using CSS variables for light and dark themes (see globals.css). */
export async function highlight(code: string, lang: CodeLanguage): Promise<string> {
  const instance = await getHighlighter();
  return instance.codeToHtml(code.trimEnd(), {
    lang,
    themes: { light: "github-light", dark: "github-dark" },
    defaultColor: false,
  });
}
