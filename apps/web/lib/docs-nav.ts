/** Documentation navigation and per-page "On this page" entries. */

export type DocsNavItem = { title: string; href: string };
export type DocsNavSection = { title: string; items: DocsNavItem[] };
export type TocEntry = { id: string; title: string };

export const DOCS_NAV: DocsNavSection[] = [
  {
    title: "Overview",
    items: [
      { title: "Introduction", href: "/developers/docs" },
      { title: "Getting started", href: "/developers/docs/getting-started" },
      { title: "Authentication", href: "/developers/docs/authentication" },
    ],
  },
  {
    title: "Endpoints",
    items: [
      { title: "Geocoding", href: "/developers/docs/geocoding" },
      { title: "Routing", href: "/developers/docs/routing" },
    ],
  },
  {
    title: "Guides",
    items: [
      { title: "Errors", href: "/developers/docs/errors" },
      { title: "Rate limits", href: "/developers/docs/rate-limits" },
      { title: "Versioning", href: "/developers/docs/versioning" },
      { title: "Code examples", href: "/developers/docs/examples" },
    ],
  },
  {
    title: "Reference",
    items: [{ title: "API reference", href: "/developers/api-reference" }],
  },
];

export const DOCS_TOC: Record<string, TocEntry[]> = {
  introduction: [
    { id: "what-you-can-build", title: "What you can build" },
    { id: "base-url", title: "Base URL" },
    { id: "conventions", title: "Conventions" },
    { id: "data-sources", title: "Data sources" },
    { id: "next-steps", title: "Next steps" },
  ],
  "getting-started": [
    { id: "create-an-account", title: "1. Create an account" },
    { id: "create-an-api-key", title: "2. Create an API key" },
    { id: "make-your-first-request", title: "3. Make your first request" },
    { id: "read-the-response", title: "4. Read the response" },
    { id: "integrate", title: "5. Integrate" },
  ],
  authentication: [
    { id: "api-keys", title: "API keys" },
    { id: "sending-your-key", title: "Sending your key" },
    { id: "keeping-keys-safe", title: "Keeping keys safe" },
    { id: "managing-keys", title: "Managing keys" },
    { id: "playground-tokens", title: "Playground tokens" },
    { id: "authentication-errors", title: "Authentication errors" },
  ],
  geocoding: [
    { id: "request", title: "Request" },
    { id: "parameters", title: "Parameters" },
    { id: "example", title: "Example" },
    { id: "response", title: "Response" },
    { id: "ranking", title: "Ranking" },
    { id: "reverse", title: "Reverse geocoding" },
    { id: "errors", title: "Errors" },
    { id: "try-it", title: "Try it" },
  ],
  routing: [
    { id: "request", title: "Request" },
    { id: "parameters", title: "Parameters" },
    { id: "example", title: "Example" },
    { id: "response", title: "Response" },
    { id: "travel-modes", title: "Travel modes" },
    { id: "snapping", title: "Snapping to roads" },
    { id: "errors", title: "Errors" },
    { id: "try-it", title: "Try it" },
  ],
  errors: [
    { id: "error-format", title: "Error format" },
    { id: "error-codes", title: "Error codes" },
    { id: "handling-errors", title: "Handling errors" },
    { id: "request-ids", title: "Request IDs" },
  ],
  "rate-limits": [
    { id: "limits", title: "Limits" },
    { id: "headers", title: "Response headers" },
    { id: "when-you-hit-the-limit", title: "When you hit the limit" },
    { id: "best-practices", title: "Best practices" },
  ],
  versioning: [
    { id: "versions", title: "Versions" },
    { id: "compatible-changes", title: "Compatible changes" },
    { id: "breaking-changes", title: "Breaking changes" },
    { id: "deprecation", title: "Deprecation" },
  ],
  examples: [
    { id: "curl", title: "cURL" },
    { id: "javascript", title: "JavaScript" },
    { id: "typescript", title: "TypeScript" },
    { id: "python", title: "Python" },
    { id: "flutter-dart", title: "Flutter / Dart" },
  ],
};

/** Flattened list, used for previous/next links. */
export const DOCS_PAGES: DocsNavItem[] = DOCS_NAV.flatMap((section) => section.items).filter((item) =>
  item.href.startsWith("/developers/docs"),
);

export function isActiveDocsLink(pathname: string, href: string): boolean {
  const normalized = pathname.replace(/\/+$/, "") || "/";
  return normalized === href;
}
