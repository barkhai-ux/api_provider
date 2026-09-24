import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { A, C, Callout, FieldTable, H2, OL, P, UL } from "@/components/docs/prose";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";
import { geocodeExamples } from "@/lib/docs/examples";

export const metadata: Metadata = {
  title: "Getting started",
  description: "Create an account, create an API key and make your first geocoding request.",
};

const FIRST_RESPONSE = JSON.stringify(
  {
    query: "Ulaanbaatar",
    results: [
      {
        id: "loc_ff6ee5b78230a6a5",
        name: "Ulaanbaatar OU School",
        address: "18-р хороо, Хан-Уул, Mongolia",
        latitude: 47.89872,
        longitude: 106.92998,
        type: "poi",
      },
      {
        id: "loc_868bb41091d20580",
        name: "Ulaanbaatar 2 Station",
        address: "29-р хороо, Баянгол, Mongolia",
        latitude: 47.908137,
        longitude: 106.844495,
        type: "poi",
      },
    ],
    count: 2,
  },
  null,
  2,
);

export default function GettingStartedPage() {
  const apiUrl = publicConfig.apiUrl;
  return (
    <DocsPage
      href="/developers/docs/getting-started"
      eyebrow="Overview"
      title="Getting started"
      description="From zero to your first geocoding result in five steps."
      toc={DOCS_TOC["getting-started"]}
    >
      <H2 id="create-an-account">1. Create an account</H2>
      <P>
        <A href="/register">Create a developer account</A> with your name, email and a password of at least 10
        characters. You are signed in right away and land on the developer dashboard.
      </P>

      <H2 id="create-an-api-key">2. Create an API key</H2>
      <OL>
        <li>
          Open <A href="/dashboard/api-keys">API keys</A> in the dashboard.
        </li>
        <li>
          Choose <strong>Create API key</strong>, give it a name that says where it is used (for example
          &quot;Production backend&quot;), choose the endpoints it may call and when it expires, and confirm.
        </li>
        <li>
          Copy the key or download it. It looks like <C>geo_</C> followed by 32 letters and digits.
        </li>
      </OL>
      <Callout tone="warning" title="The key is shown only once">
        Only a hash of the key is stored, so it cannot be displayed again. If you lose it, regenerate the key or create
        a new one.
      </Callout>

      <H2 id="make-your-first-request">3. Make your first request</H2>
      <P>Search for a place with the geocoding endpoint. Replace <C>YOUR_API_KEY</C> with your key:</P>
      <CodeBlock
        lang="bash"
        title="Terminal"
        code={`curl "${apiUrl}/v1/geocode?q=Ulaanbaatar" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`}
      />
      <P>The same request in other languages:</P>
      <CodeTabs examples={geocodeExamples(apiUrl, "Ulaanbaatar", 5)} />

      <H2 id="read-the-response">4. Read the response</H2>
      <P>A successful request returns <C>200 OK</C> with a JSON body like this:</P>
      <CodeBlock lang="json" title="200 OK" code={FIRST_RESPONSE} />
      <FieldTable
        fields={[
          { name: "query", type: "string", description: "The search text, with whitespace normalized." },
          { name: "results", type: "array", description: "Matches, best first. Empty when nothing matched (still 200)." },
          { name: "results[].latitude / longitude", type: "number", description: "Where the place is (WGS84)." },
          { name: "count", type: "integer", description: "Number of results returned." },
        ]}
      />
      <P>
        Also look at the response headers: <C>X-RateLimit-Remaining</C> tells you how many requests you have left in the
        current minute, and <C>X-Request-ID</C> identifies the request if you need support.
      </P>

      <H2 id="integrate">5. Integrate into your application</H2>
      <UL>
        <li>
          Keep the key on your server and call the API from there. Browser or mobile apps should call your own backend,
          which adds the key. See <A href="/developers/docs/authentication#keeping-keys-safe">Keeping keys safe</A>.
        </li>
        <li>
          Set a timeout on every request and cancel stale ones (for example with an <C>AbortController</C> in
          JavaScript). See <A href="/developers/docs/examples">Code examples</A> for each language.
        </li>
        <li>
          Handle errors by their <C>code</C>, and back off when you get <C>429</C>. See{" "}
          <A href="/developers/docs/errors">Errors</A> and <A href="/developers/docs/rate-limits">Rate limits</A>.
        </li>
        <li>
          For search-as-you-type, wait about 300 ms after the last keystroke before calling <C>/v1/geocode</C>, and cancel
          the previous request when a new one starts.
        </li>
        <li>
          Watch your traffic on the <A href="/dashboard/usage">Usage</A> page of the dashboard.
        </li>
      </UL>
    </DocsPage>
  );
}
