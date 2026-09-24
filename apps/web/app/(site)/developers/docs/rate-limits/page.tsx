import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { A, C, DocTable, H2, P, UL } from "@/components/docs/prose";
import { DOCS_TOC } from "@/lib/docs-nav";
import { errorBody } from "@/lib/docs/responses";

export const metadata: Metadata = {
  title: "Rate limits",
  description: "Per-key request limits, rate-limit headers and how to handle 429 responses.",
};

export default function RateLimitsPage() {
  return (
    <DocsPage
      href="/developers/docs/rate-limits"
      eyebrow="Guides"
      title="Rate limits"
      description="Each API key can make a fixed number of requests per minute. Every response tells you where you stand."
      toc={DOCS_TOC["rate-limits"]}
    >
      <H2 id="limits">Limits</H2>
      <UL>
        <li>
          The default limit is <strong>100 requests per minute per API key</strong>. Your current limit is shown on the{" "}
          <A href="/dashboard">dashboard</A>; a key can have its own limit.
        </li>
        <li>
          Windows are fixed and aligned to the clock: 12:00:00–12:00:59, 12:01:00–12:01:59, and so on. The count resets
          at the start of each minute.
        </li>
        <li>
          Every authenticated request counts, including requests that end in an error (for example a 400 for an invalid
          parameter). Requests rejected for a missing or invalid key are not counted against any key.
        </li>
        <li>Limits apply per key, not per account: two keys have two separate budgets.</li>
      </UL>

      <H2 id="headers">Response headers</H2>
      <P>
        Every <C>/v1</C> response from an authenticated request, including errors, carries these headers:
      </P>
      <DocTable
        caption="Rate-limit headers"
        columns={[{ header: "Header", className: "w-56" }, { header: "Meaning" }]}
        rows={[
          [<C key="h">X-RateLimit-Limit</C>, "Requests allowed in each one-minute window."],
          [<C key="h">X-RateLimit-Remaining</C>, "Requests left in the current window."],
          [<C key="h">X-RateLimit-Reset</C>, "When the current window ends, as a Unix timestamp in seconds."],
          [<C key="h">Retry-After</C>, "Only on 429: seconds to wait before retrying."],
        ]}
      />
      <CodeBlock
        lang="http"
        title="Response headers"
        code={`HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 87
X-RateLimit-Reset: 1790230080
X-Request-ID: 21ca93219865458f9b027c782e5a27b3`}
      />
      <P>Browsers can read these headers from cross-origin requests; the API exposes them through CORS.</P>

      <H2 id="when-you-hit-the-limit">When you hit the limit</H2>
      <P>
        Once the window is used up, requests fail with <C>429 Too Many Requests</C> until it resets:
      </P>
      <CodeBlock
        lang="http"
        title="429 Too Many Requests"
        code={`HTTP/1.1 429 Too Many Requests
Retry-After: 23
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 0
X-RateLimit-Reset: 1790230080

${errorBody("RATE_LIMIT_EXCEEDED", "Too many requests.", { limit: 100 })}`}
      />
      <P>
        Wait at least <C>Retry-After</C> seconds before trying again. Retrying immediately only adds more rejected
        requests.
      </P>

      <H2 id="best-practices">Best practices</H2>
      <UL>
        <li>
          Read <C>X-RateLimit-Remaining</C> and slow down before it reaches zero, instead of waiting for 429s.
        </li>
        <li>On 429, sleep until <C>X-RateLimit-Reset</C> (or for <C>Retry-After</C> seconds), then retry.</li>
        <li>
          For other retryable errors use exponential backoff with jitter (for example 0.5 s, 1 s, 2 s) and a maximum
          number of attempts.
        </li>
        <li>Debounce search-as-you-type (about 300 ms) and cancel superseded requests.</li>
        <li>Cache results you look up repeatedly, such as the addresses of your own locations.</li>
        <li>
          If you need a higher limit, use separate keys per application or contact the platform team.
        </li>
      </UL>
    </DocsPage>
  );
}
