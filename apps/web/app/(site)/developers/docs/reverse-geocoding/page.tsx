import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { ErrorTable } from "@/components/docs/error-table";
import { A, C, Endpoint, FieldTable, H2, OL, P, ParamTable } from "@/components/docs/prose";
import { Playground } from "@/components/playground/playground";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";
import { errorsFor } from "@/lib/docs/errors";
import { reverseGeocodeExamples } from "@/lib/docs/examples";
import { REVERSE_GEOCODE_RESPONSE, errorBody } from "@/lib/docs/responses";

export const metadata: Metadata = {
  title: "Reverse geocoding",
  description: "GET /v1/reverse-geocode turns coordinates into the nearest address, place or street.",
};

export default function ReverseGeocodingPage() {
  return (
    <DocsPage
      href="/developers/docs/reverse-geocoding"
      eyebrow="Endpoints"
      title="Reverse geocoding"
      description="Turn a latitude and longitude into a meaningful location: the nearest address, place or street."
      toc={DOCS_TOC["reverse-geocoding"]}
    >
      <H2 id="request">Request</H2>
      <Endpoint method="GET" path="/v1/reverse-geocode" />
      <P>
        Requires an API key in the <C>Authorization</C> header.
      </P>

      <H2 id="parameters">Parameters</H2>
      <ParamTable
        params={[
          { name: "lat", type: "number", required: true, description: "Latitude in decimal degrees (WGS84), -90 to 90." },
          { name: "lon", type: "number", required: true, description: "Longitude in decimal degrees (WGS84), -180 to 180." },
        ]}
      />

      <H2 id="example">Example</H2>
      <CodeTabs examples={reverseGeocodeExamples(publicConfig.apiUrl)} />

      <H2 id="response">Response</H2>
      <CodeBlock lang="json" title="200 OK" code={REVERSE_GEOCODE_RESPONSE} />
      <FieldTable
        fields={[
          { name: "location", type: "object", description: "The coordinates you sent (latitude, longitude)." },
          { name: "address.formatted", type: "string", description: "One-line address, ready to display." },
          { name: "address.name", type: "string | null", description: "Building, place or street name." },
          { name: "address.house_number", type: "string | null", description: "House or building number, when known." },
          { name: "address.street", type: "string | null", description: "Street name, when known." },
          { name: "address.neighborhood", type: "string | null", description: "Sub-district (khoroo or bag), when known." },
          { name: "address.district", type: "string | null", description: "District (düüreg or sum), when known." },
          { name: "address.city", type: "string | null", description: "City." },
          { name: "address.country", type: "string | null", description: "Country." },
          {
            name: "match_type",
            type: "string",
            description: (
              <>
                What the address came from: <C>address</C>, <C>place</C> or <C>street</C>.
              </>
            ),
          },
          {
            name: "distance_meters",
            type: "number",
            description: "Distance from the requested point to the matched feature.",
          },
        ]}
      />
      <P>
        Fields that are not known are <C>null</C>. Always display <C>address.formatted</C> and treat the components as
        optional.
      </P>

      <H2 id="how-matches-are-found">How matches are found</H2>
      <P>
        The API searches outward from the point, first within 100 m, then 500 m, then 2 km, and returns the closest
        match it finds. <C>match_type</C> tells you what the match is:
      </P>
      <OL>
        <li>an address point (<C>&quot;address&quot;</C>),</li>
        <li>a named place such as a building, shop or landmark (<C>&quot;place&quot;</C>),</li>
        <li>or a named street (<C>&quot;street&quot;</C>).</li>
      </OL>
      <P>
        A closer match is always preferred over a more distant one. Use <C>distance_meters</C> to decide whether the
        match is close enough for your use case.
      </P>

      <H2 id="errors">Errors</H2>
      <P>
        When nothing is found within 2 km the API answers <C>404 NOT_FOUND</C>:
      </P>
      <CodeBlock
        lang="json"
        title="404 Not Found"
        code={errorBody("NOT_FOUND", "No address or place was found near this location.")}
      />
      <ErrorTable errors={errorsFor([400, 401, 403, 404, 408, 429, 500, 502, 503])} showAction={false} />
      <P>
        See <A href="/developers/docs/errors">Errors</A> for how to handle each code.
      </P>

      <H2 id="try-it">Try it</H2>
      <Playground endpoint="reverse-geocode" />
    </DocsPage>
  );
}
