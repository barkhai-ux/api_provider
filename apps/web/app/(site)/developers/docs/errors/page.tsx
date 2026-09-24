import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { ErrorTable } from "@/components/docs/error-table";
import { A, C, FieldTable, H2, H3, P, UL } from "@/components/docs/prose";
import { DOCS_TOC } from "@/lib/docs-nav";
import { ERROR_CATALOG } from "@/lib/docs/errors";
import { errorBody } from "@/lib/docs/responses";

export const metadata: Metadata = {
  title: "Errors",
  description: "The error envelope and every error code the API returns.",
};

const HANDLING_EXAMPLES = [
  {
    label: "TypeScript",
    lang: "typescript" as const,
    code: `const RETRYABLE = new Set(["RATE_LIMIT_EXCEEDED", "REQUEST_TIMEOUT", "UPSTREAM_ERROR", "SERVICE_UNAVAILABLE"]);

async function getWithRetry(url: string, attempts = 3): Promise<unknown> {
  for (let attempt = 1; ; attempt++) {
    const response = await fetch(url, {
      headers: { Authorization: \`Bearer \${process.env.GEO_API_KEY}\` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.ok) return response.json();
    const { error } = (await response.json()) as { error: { code: string; message: string } };
    if (!RETRYABLE.has(error.code) || attempt === attempts) {
      throw new Error(\`\${error.code}: \${error.message}\`);
    }
    // Honour Retry-After on 429, otherwise back off exponentially.
    const retryAfter = Number(response.headers.get("Retry-After"));
    const waitMs = retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
}`,
  },
  {
    label: "Python",
    lang: "python" as const,
    code: `import time

import httpx

RETRYABLE = {"RATE_LIMIT_EXCEEDED", "REQUEST_TIMEOUT", "UPSTREAM_ERROR", "SERVICE_UNAVAILABLE"}


def get_with_retry(client: httpx.Client, url: str, params: dict, attempts: int = 3) -> dict:
    for attempt in range(1, attempts + 1):
        response = client.get(url, params=params)
        if response.is_success:
            return response.json()
        error = response.json()["error"]
        if error["code"] not in RETRYABLE or attempt == attempts:
            raise RuntimeError(f"{error['code']}: {error['message']}")
        delay = int(response.headers.get("Retry-After", 2**attempt))
        time.sleep(delay)
    raise AssertionError("unreachable")`,
  },
];

export default function ErrorsPage() {
  return (
    <DocsPage
      href="/developers/docs/errors"
      eyebrow="Guides"
      title="Errors"
      description="Every error response has the same shape, with a stable code you can branch on."
      toc={DOCS_TOC.errors}
    >
      <H2 id="error-format">Error format</H2>
      <P>
        Any response with a status of 400 or above has this JSON body, whatever the endpoint and whatever went wrong:
      </P>
      <CodeBlock
        lang="json"
        title="400 Bad Request"
        code={errorBody("INVALID_REQUEST", "The latitude value is invalid.", { field: "lat" })}
      />
      <FieldTable
        caption="Error fields"
        fields={[
          { name: "error.code", type: "string", description: "Stable, machine-readable code. Branch on this." },
          {
            name: "error.message",
            type: "string",
            description: "Human-readable explanation. The wording may change, so do not parse it.",
          },
          {
            name: "error.details",
            type: "object",
            description: (
              <>
                Optional context, for example <C>field</C> (the invalid parameter), <C>reason</C> or{" "}
                <C>limit</C>. Only present when there is something useful to add.
              </>
            ),
          },
        ]}
      />

      <H2 id="error-codes">Error codes</H2>
      <ErrorTable errors={ERROR_CATALOG} />
      {ERROR_CATALOG.map((error) => (
        <div key={error.code}>
          <H3 id={error.code.toLowerCase().replace(/_/g, "-")}>
            {error.status} {error.code}
          </H3>
          <CodeBlock
            lang="json"
            title={`${error.status} response`}
            code={errorBody(error.code, error.example.message, error.example.details)}
          />
        </div>
      ))}

      <H2 id="handling-errors">Handling errors</H2>
      <UL>
        <li>
          <strong>Fix and resend</strong>: <C>INVALID_REQUEST</C>, <C>NOT_FOUND</C>. Retrying the same request gives the
          same answer.
        </li>
        <li>
          <strong>Fix the credentials</strong>: <C>INVALID_API_KEY</C>, <C>API_KEY_REVOKED</C>. Do not retry in a loop.
        </li>
        <li>
          <strong>Retry with backoff</strong>: <C>RATE_LIMIT_EXCEEDED</C> (wait for <C>Retry-After</C>),{" "}
          <C>REQUEST_TIMEOUT</C>, <C>UPSTREAM_ERROR</C>, <C>SERVICE_UNAVAILABLE</C> and <C>INTERNAL_ERROR</C>. Use
          exponential backoff with a cap, and give up after a few attempts.
        </li>
      </UL>
      <CodeTabs examples={HANDLING_EXAMPLES} />

      <H2 id="request-ids">Request IDs</H2>
      <P>
        Every response, successful or not, carries an <C>X-Request-ID</C> header. Log it with errors and include it
        when you ask for help: it identifies the exact request. You can also send your own <C>X-Request-ID</C> (8–64
        letters, digits, <C>.</C>, <C>_</C> or <C>-</C>) to correlate requests with your logs; otherwise one is
        generated. Rate-limit headers are described in <A href="/developers/docs/rate-limits">Rate limits</A>.
      </P>
    </DocsPage>
  );
}
