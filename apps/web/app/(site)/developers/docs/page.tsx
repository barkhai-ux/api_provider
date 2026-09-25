import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { A, C, Callout, DocTable, H2, P, UL } from "@/components/docs/prose";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";

export const metadata: Metadata = {
  title: "Documentation",
  description: "Geocoding, reverse geocoding and routing APIs: concepts, authentication and examples.",
};

export default function DocsIntroductionPage() {
  const apiUrl = publicConfig.apiUrl;
  return (
    <DocsPage
      href="/developers/docs"
      eyebrow="Documentation"
      title="Introduction"
      description="Ubhub Location Service offers three HTTP APIs for location-aware applications in Mongolia: geocoding, reverse geocoding and routing."
      toc={DOCS_TOC.introduction}
    >
      <H2 id="what-you-can-build">What you can build</H2>
      <DocTable
        caption="Available APIs"
        columns={[{ header: "API", className: "w-44" }, { header: "Endpoint", className: "w-48" }, { header: "Use it to" }]}
        rows={[
          [<A key="a" href="/developers/docs/geocoding">Geocoding</A>, <C key="b">GET /v1/geocode</C>, "Turn place names and addresses into coordinates, for search boxes and autocomplete."],
          [<A key="a" href="/developers/docs/reverse-geocoding">Reverse geocoding</A>, <C key="b">GET /v1/reverse-geocode</C>, "Turn a latitude and longitude into the nearest address, place or street."],
          [<A key="a" href="/developers/docs/routing">Routing</A>, <C key="b">GET /v1/route</C>, "Get the fastest driving or walking route, its distance, travel time and a GeoJSON line."],
        ]}
      />
      <P>
        The interactive map on the <A href="/">home page</A> is built on exactly these endpoints, so what you see there is
        what your application gets.
      </P>

      <H2 id="base-url">Base URL</H2>
      <P>All endpoints live under a versioned path on one host:</P>
      <CodeBlock code={`${apiUrl}/v1`} lang="bash" title="Base URL" />
      <P>
        Every request needs an API key in the <C>Authorization</C> header. See{" "}
        <A href="/developers/docs/authentication">Authentication</A>.
      </P>

      <H2 id="conventions">Conventions</H2>
      <UL>
        <li>All endpoints use <C>GET</C> with query parameters and return JSON (UTF-8).</li>
        <li>
          Coordinates are WGS84 decimal degrees. Separate parameters are named <C>lat</C> and <C>lon</C>; combined
          values such as <C>origin</C> use GeoJSON order: <C>longitude,latitude</C>.
        </li>
        <li>Distances are in meters and durations in seconds.</li>
        <li>Geometries are GeoJSON, so they can be added to MapLibre, Mapbox GL, Leaflet or OpenLayers directly.</li>
        <li>
          Errors always use the same envelope: <C>{`{"error": {"code", "message", "details"}}`}</C>. See{" "}
          <A href="/developers/docs/errors">Errors</A>.
        </li>
        <li>
          Every response carries rate-limit headers and an <C>X-Request-ID</C>. See{" "}
          <A href="/developers/docs/rate-limits">Rate limits</A>.
        </li>
      </UL>

      <H2 id="data-sources">Data sources</H2>
      <P>
        Results come from the platform&apos;s own geospatial data sources. Which places, addresses and roads are
        available depends on the data configured for this deployment, so coverage can differ between areas. The API
        contract (paths, parameters and response fields) stays the same whatever the underlying data source is.
      </P>
      <Callout title="Version stability">
        <C>/v1</C> never receives breaking changes. New optional response fields may be added, so parse responses
        leniently. Read <A href="/developers/docs/versioning">Versioning</A> for the full policy.
      </Callout>

      <H2 id="next-steps">Next steps</H2>
      <UL>
        <li>
          <A href="/developers/docs/getting-started">Getting started</A>: create a key and make your first request in
          five minutes.
        </li>
        <li>
          <A href="/developers/api-reference">API reference</A>: every parameter and field, with a playground to try
          requests from the browser.
        </li>
        <li>
          <A href="/developers/docs/examples">Code examples</A>: cURL, JavaScript, TypeScript, Python and Dart
          snippets.
        </li>
      </UL>
    </DocsPage>
  );
}
