import type { Metadata } from "next";
import { DocsPage } from "@/components/docs/docs-page";
import { C, Callout, H2, P, UL } from "@/components/docs/prose";
import { DOCS_TOC } from "@/lib/docs-nav";

export const metadata: Metadata = {
  title: "Versioning",
  description: "How the API is versioned and what can change within a version.",
};

export default function VersioningPage() {
  return (
    <DocsPage
      href="/developers/docs/versioning"
      eyebrow="Guides"
      title="Versioning"
      description="The version is part of the URL. Within a version, your integration keeps working."
      toc={DOCS_TOC.versioning}
    >
      <H2 id="versions">Versions</H2>
      <P>
        The current version is <C>v1</C>, and every endpoint lives under <C>/v1/</C>. A new major version, such as{" "}
        <C>/v2/</C>, is introduced only when a breaking change is unavoidable. The two versions then run side by side so
        you can migrate at your own pace.
      </P>

      <H2 id="compatible-changes">Compatible changes</H2>
      <P>These can happen within <C>v1</C> at any time, without notice:</P>
      <UL>
        <li>New endpoints.</li>
        <li>New optional query parameters.</li>
        <li>New fields in response objects.</li>
        <li>
          New values in open-ended fields, such as a new place <C>type</C> or a new <C>details</C> entry on an error.
        </li>
        <li>New travel modes.</li>
        <li>Better results from the same request, for example after the underlying data is updated.</li>
        <li>Changes to error <C>message</C> text (branch on <C>code</C>, never on the message).</li>
      </UL>
      <Callout title="Build tolerant clients">
        Ignore response fields you do not know, and do not fail on unknown values of open-ended fields such as{" "}
        <C>type</C>.
      </Callout>

      <H2 id="breaking-changes">Breaking changes</H2>
      <P>These never happen within <C>v1</C>:</P>
      <UL>
        <li>Removing or renaming an endpoint, parameter or response field.</li>
        <li>Changing the type or meaning of an existing field.</li>
        <li>Making an optional parameter required, or tightening its accepted values.</li>
        <li>Changing the error envelope or removing an error code.</li>
        <li>Changing authentication.</li>
      </UL>

      <H2 id="deprecation">Deprecation</H2>
      <P>
        When a new major version ships, the previous one stays available for a published transition period. Deprecated
        versions are announced in this documentation before they are retired, with a migration guide covering every
        change.
      </P>
    </DocsPage>
  );
}
