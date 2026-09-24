import type { Metadata } from "next";
import { CodeBlock, CodeTabs } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { ErrorTable } from "@/components/docs/error-table";
import { A, C, Callout, DocTable, Endpoint, FieldTable, H2, P, ParamTable, UL } from "@/components/docs/prose";
import { Playground } from "@/components/playground/playground";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";
import { errorsFor } from "@/lib/docs/errors";
import { routeExamples } from "@/lib/docs/examples";
import { ROUTE_RESPONSE, errorBody } from "@/lib/docs/responses";

export const metadata: Metadata = {
  title: "Routing",
  description: "GET /v1/route calculates the fastest route, its distance and travel time.",
};

export default function RoutingPage() {
  return (
    <DocsPage
      href="/developers/docs/routing"
      eyebrow="Endpoints"
      title="Routing"
      description="Calculate the fastest route between two points, with distance, estimated travel time and a GeoJSON line."
      toc={DOCS_TOC.routing}
    >
      <H2 id="request">Request</H2>
      <Endpoint method="GET" path="/v1/route" />
      <P>
        Requires an API key in the <C>Authorization</C> header.
      </P>

      <H2 id="parameters">Parameters</H2>
      <ParamTable
        params={[
          {
            name: "origin",
            type: "string",
            required: true,
            description: (
              <>
                Start point as <C>longitude,latitude</C> (GeoJSON order), for example <C>106.9177,47.9184</C>.
              </>
            ),
          },
          {
            name: "destination",
            type: "string",
            required: true,
            description: (
              <>
                End point as <C>longitude,latitude</C>, for example <C>106.9057,47.9220</C>.
              </>
            ),
          },
          {
            name: "mode",
            type: "string",
            description: (
              <>
                <C>driving</C> (default) or <C>walking</C>.
              </>
            ),
          },
        ]}
      />
      <Callout tone="warning" title="Longitude first">
        <C>origin</C> and <C>destination</C> put longitude before latitude, like GeoJSON. Swapping them usually gives a
        400 error (latitude out of range) or a point in the wrong place.
      </Callout>

      <H2 id="example">Example</H2>
      <CodeTabs examples={routeExamples(publicConfig.apiUrl)} />

      <H2 id="response">Response</H2>
      <CodeBlock lang="json" title="200 OK" code={ROUTE_RESPONSE} />
      <FieldTable
        fields={[
          { name: "route.distance_meters", type: "number", description: "Length of the route in meters." },
          { name: "route.duration_seconds", type: "number", description: "Estimated travel time in seconds." },
          {
            name: "route.geometry",
            type: "LineString",
            description: (
              <>
                GeoJSON LineString. <C>coordinates</C> are <C>[longitude, latitude]</C> pairs from origin to destination.
              </>
            ),
          },
          { name: "mode", type: "string", description: "The travel mode used." },
          {
            name: "waypoints",
            type: "array",
            description: "Two entries, origin then destination, describing where each point joined the road network.",
          },
          { name: "waypoints[].input", type: "object", description: "The coordinate you sent." },
          { name: "waypoints[].location", type: "object", description: "The point on the road network used instead." },
          { name: "waypoints[].snap_distance_meters", type: "number", description: "Distance between input and location." },
          { name: "waypoints[].name", type: "string | null", description: "Name of the road at the snapped point." },
        ]}
      />

      <H2 id="travel-modes">Travel modes</H2>
      <DocTable
        caption="Travel modes"
        columns={[{ header: "Mode", className: "w-28" }, { header: "Behavior" }]}
        rows={[
          [
            <C key="m">driving</C>,
            "Uses roads open to cars, respects one-way streets, and estimates time from road speeds.",
          ],
          [<C key="m">walking</C>, "Uses streets and footpaths, ignores one-way rules, avoids motorways, at about 5 km/h."],
        ]}
      />
      <P>More modes may be added to <C>/v1</C> later; adding a mode is not a breaking change.</P>

      <H2 id="snapping">Snapping to roads</H2>
      <UL>
        <li>
          Origin and destination are moved to the nearest road the chosen mode can use. <C>waypoints</C> shows where.
        </li>
        <li>
          If no usable road is close enough to a point, the API answers <C>404 NOT_FOUND</C> with{" "}
          <C>details.reason</C> set to <C>origin_not_on_network</C> or <C>destination_not_on_network</C>.
        </li>
        <li>
          Origin and destination must be within the maximum route distance for this deployment (100 km by default);
          otherwise you get <C>400 INVALID_REQUEST</C> on <C>destination</C>.
        </li>
      </UL>

      <H2 id="errors">Errors</H2>
      <CodeBlock
        lang="json"
        title="404 Not Found"
        code={errorBody("NOT_FOUND", "No driving route connects the origin and the destination.", { reason: "no_path" })}
      />
      <ErrorTable errors={errorsFor([400, 401, 403, 404, 408, 429, 500, 502, 503])} showAction={false} />
      <P>
        See <A href="/developers/docs/errors">Errors</A> for how to handle each code.
      </P>

      <H2 id="try-it">Try it</H2>
      <Playground endpoint="route" />
    </DocsPage>
  );
}
