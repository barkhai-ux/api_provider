import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { ErrorTable } from "@/components/docs/error-table";
import { A, C, Callout, Endpoint, FieldTable, H2, OL, P, ParamTable } from "@/components/docs/prose";
import { Playground } from "@/components/playground/playground";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";
import { errorsFor } from "@/lib/docs/errors";
import { geocodeExamples } from "@/lib/docs/examples";
import { GEOCODE_EMPTY_RESPONSE, GEOCODE_RESPONSE } from "@/lib/docs/responses";

export const metadata: Metadata = {
  title: "Geocoding",
  description: "GET /v1/geocode turns place names and addresses into coordinates.",
};

export default function GeocodingPage() {
  return (
    <DocsPage
      href="/developers/docs/geocoding"
      eyebrow="Endpoints"
      title="Geocoding"
      description="Turn a place name or address into coordinates. Use it for search boxes, autocomplete and address lookup."
      toc={DOCS_TOC.geocoding}
    >
      <H2 id="request">Request</H2>
      <Endpoint method="GET" path="/v1/geocode" />
      <P>
        Requires an API key in the <C>Authorization</C> header. See{" "}
        <A href="/developers/docs/authentication">Authentication</A>.
      </P>

      <H2 id="parameters">Parameters</H2>
      <ParamTable
        params={[
          {
            name: "q",
            type: "string",
            required: true,
            description: (
              <>
                Place name or address, 2 to 200 characters, with at least 2 letters or digits. Latin and Cyrillic are
                both supported, for example <C>Sukhbaatar Square</C> or <C>Сүхбаатарын талбай</C>.
              </>
            ),
          },
          {
            name: "limit",
            type: "integer",
            description: (
              <>
                Maximum number of results, 1 to 20. Default <C>5</C>.
              </>
            ),
          },
        ]}
      />

      <H2 id="example">Example</H2>
      <CodeTabs examples={geocodeExamples(publicConfig.apiUrl)} />

      <H2 id="response">Response</H2>
      <CodeBlock lang="json" title="200 OK" code={GEOCODE_RESPONSE} />
      <FieldTable
        fields={[
          { name: "query", type: "string", description: "The search text, with whitespace normalized." },
          { name: "results", type: "array", description: "Matches, best first." },
          { name: "results[].id", type: "string", description: "Opaque, stable identifier of the place." },
          { name: "results[].name", type: "string", description: "Display name." },
          { name: "results[].address", type: "string | null", description: "Address or area the place is in." },
          { name: "results[].latitude", type: "number", description: "Latitude (WGS84), up to 6 decimals." },
          { name: "results[].longitude", type: "number", description: "Longitude (WGS84), up to 6 decimals." },
          {
            name: "results[].type",
            type: "string",
            description: (
              <>
                Result category in lower case, for example <C>poi</C> for a point of interest, or <C>place</C> when
                no category is known.
              </>
            ),
          },
          { name: "count", type: "integer", description: "Number of results in this response." },
        ]}
      />
      <P>No match is not an error: you get <C>200 OK</C> with an empty list.</P>
      <CodeBlock lang="json" title="200 OK (no match)" code={GEOCODE_EMPTY_RESPONSE} />

      <H2 id="ranking">Ranking</H2>
      <P>Results are ordered by how well the name matches the query:</P>
      <OL>
        <li>Exact name matches.</li>
        <li>Names that start with the query.</li>
        <li>Names where every word of the query starts a word.</li>
        <li>Names that contain every word of the query.</li>
      </OL>
      <P>Within each group, more prominent places come first, then shorter names.</P>
      <Callout title="Building autocomplete">
        Wait about 300 ms after the last keystroke before sending a request, cancel the previous request when a new one
        starts (in JavaScript, pass an <C>AbortController</C> signal to <C>fetch</C>), and do not search until the
        user has typed at least 2 characters.
      </Callout>

      <H2 id="errors">Errors</H2>
      <ErrorTable errors={errorsFor([400, 401, 403, 408, 429, 500, 502, 503])} showAction={false} />
      <P>
        See <A href="/developers/docs/errors">Errors</A> for the response format and how to handle each code.
      </P>

      <H2 id="try-it">Try it</H2>
      <P>Send a real request with one of your keys.</P>
      <Playground endpoint="geocode" />
    </DocsPage>
  );
}
