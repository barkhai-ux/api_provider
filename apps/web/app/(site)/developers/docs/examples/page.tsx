import type { Metadata } from "next";
import { CodeTabs } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { A, C, Callout, H2, P } from "@/components/docs/prose";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";
import { geocodeExamples, reverseGeocodeExamples, routeExamples } from "@/lib/docs/examples";

export const metadata: Metadata = {
  title: "Code examples",
  description: "Ready-to-use requests in cURL, JavaScript, TypeScript, Python and Dart.",
};

function byLabel(label: string) {
  const apiUrl = publicConfig.apiUrl;
  const pick = (examples: ReturnType<typeof geocodeExamples>, title: string) => {
    const example = examples.find((item) => item.label === label);
    return example ? [{ ...example, label: title }] : [];
  };
  return [
    ...pick(geocodeExamples(apiUrl), "Geocode"),
    ...pick(reverseGeocodeExamples(apiUrl), "Reverse geocode"),
    ...pick(routeExamples(apiUrl), "Route"),
  ];
}

export default function CodeExamplesPage() {
  return (
    <DocsPage
      href="/developers/docs/examples"
      eyebrow="Guides"
      title="Code examples"
      description="The API is plain HTTPS and JSON, so any HTTP client works. These examples use each language's standard tools."
      toc={DOCS_TOC.examples}
    >
      <P>
        Every request needs your API key in the <C>Authorization</C> header, and every error uses the same envelope,
        so the pattern is the same in every language: send the request, check the status, then read the JSON. See{" "}
        <A href="/developers/docs/errors">Errors</A> for retry guidance.
      </P>

      <H2 id="curl">cURL</H2>
      <CodeTabs examples={byLabel("cURL")} />

      <H2 id="javascript">JavaScript</H2>
      <P>
        Plain <C>fetch</C>, no dependencies. Works in Node.js 18+, Deno, Bun and server-side frameworks.
      </P>
      <CodeTabs examples={byLabel("JavaScript")} />

      <H2 id="typescript">TypeScript</H2>
      <P>
        The same requests with response types. The types mirror the{" "}
        <A href="/developers/api-reference">API reference</A>; you can also generate them from the{" "}
        <A href={`${publicConfig.apiUrl}/openapi.json`}>OpenAPI schema</A> with any OpenAPI type generator.
      </P>
      <CodeTabs examples={byLabel("TypeScript")} />

      <H2 id="python">Python</H2>
      <P>
        Using <A href="https://www.python-httpx.org/">httpx</A> (<C>pip install httpx</C>); <C>requests</C> works the
        same way.
      </P>
      <CodeTabs examples={byLabel("Python")} />

      <H2 id="flutter-dart">Flutter / Dart</H2>
      <P>
        Using the <A href="https://pub.dev/packages/http">http</A> package (<C>dart pub add http</C>).
      </P>
      <Callout tone="warning" title="Do not ship keys in apps">
        Anything inside a mobile app can be extracted. In Flutter apps, call your own backend and let it call the API
        with the key.
      </Callout>
      <CodeTabs examples={byLabel("Dart")} />
    </DocsPage>
  );
}
