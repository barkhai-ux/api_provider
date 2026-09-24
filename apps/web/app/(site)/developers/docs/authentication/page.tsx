import type { Metadata } from "next";
import { CodeBlock } from "@/components/docs/code-block";
import { DocsPage } from "@/components/docs/docs-page";
import { A, C, Callout, DocTable, H2, P, UL } from "@/components/docs/prose";
import { publicConfig } from "@/lib/config";
import { DOCS_TOC } from "@/lib/docs-nav";
import { errorBody } from "@/lib/docs/responses";

export const metadata: Metadata = {
  title: "Authentication",
  description: "Authenticate API requests with a bearer API key, and keep your keys safe.",
};

export default function AuthenticationPage() {
  const apiUrl = publicConfig.apiUrl;
  return (
    <DocsPage
      href="/developers/docs/authentication"
      eyebrow="Overview"
      title="Authentication"
      description="Every /v1 request is authenticated with an API key sent as a bearer token."
      toc={DOCS_TOC.authentication}
    >
      <H2 id="api-keys">API keys</H2>
      <P>
        Keys are created in the <A href="/dashboard/api-keys">dashboard</A>. Each key belongs to your account, has its
        own name, rate limit and usage history, and looks like this:
      </P>
      <CodeBlock lang="bash" title="Key format" code={"geo_4f9KcX2mQ7rT1vZ8bN3pL6wY0sH5dJ2a"} />
      <UL>
        <li>
          <C>geo_</C> followed by 32 random letters and digits. There is one kind of key; keys created earlier with a{" "}
          <C>geo_live_</C> or <C>geo_test_</C> prefix keep working.
        </li>
        <li>
          When you create a key you choose which endpoints it can call (geocoding, reverse geocoding, routing) and when
          it expires: after 30, 60 or 90 days, after a year, on a date you pick, or never.
        </li>
        <li>
          The full key is shown <strong>once</strong>, when you create or regenerate it. The platform stores only a
          keyed hash, so nobody (including us) can show it to you again.
        </li>
        <li>
          In the dashboard a key appears masked, for example <C>geo_4f9K••••••••••••</C>.
        </li>
      </UL>

      <H2 id="sending-your-key">Sending your key</H2>
      <P>
        Send the key in the <C>Authorization</C> header using the <C>Bearer</C> scheme:
      </P>
      <CodeBlock
        lang="bash"
        title="cURL"
        code={`curl "${apiUrl}/v1/geocode?q=Ulaanbaatar" \\\n  -H "Authorization: Bearer YOUR_API_KEY"`}
      />
      <P>
        The header is the only accepted place. Keys in query strings are not supported, because URLs end up in logs,
        browser history and proxies.
      </P>

      <H2 id="keeping-keys-safe">Keeping keys safe</H2>
      <UL>
        <li>
          Treat keys like passwords. Store them in environment variables or a secret manager, never in source control.
        </li>
        <li>
          Call the API from your server. Code that runs in a browser or a mobile app can be inspected, so a key inside it
          is public. Let your app call your backend, and let the backend add the key.
        </li>
        <li>Use one key per application or environment, so you can revoke one without affecting the others.</li>
        <li>If a key may have leaked, regenerate or revoke it immediately.</li>
      </UL>
      <Callout title="How this website does it">
        The public map calls a small server-side proxy on this site, which adds the site&apos;s own key before
        forwarding to <C>/v1</C>. The key never reaches the browser.
      </Callout>

      <H2 id="managing-keys">Managing keys</H2>
      <DocTable
        caption="Key actions"
        columns={[{ header: "Action", className: "w-36" }, { header: "Effect" }]}
        rows={[
          [
            "Create",
            "Issues a new key for the endpoints you choose, with an expiry date or none, and shows the secret once. An account can have up to 25 active keys.",
          ],
          ["Rename", "Changes the label only. The secret keeps working."],
          [
            "Regenerate",
            "Issues a new secret for the same key. The old secret stops working immediately; the name, endpoints, expiry date and usage history are kept. Expired keys cannot be regenerated; create a new key instead.",
          ],
          ["Revoke", "Permanently disables the key. Requests with it get 403 API_KEY_REVOKED. This cannot be undone."],
        ]}
      />

      <H2 id="playground-tokens">Playground tokens</H2>
      <P>
        The <A href="/developers/api-reference">API reference</A> playground lets you send real requests from the
        browser with one of your keys. Because secrets are never stored, the site cannot use the key itself. Instead it
        asks for a short-lived token (<C>geo_pt_…</C>, valid 15 minutes) bound to the key you selected. Requests made
        with it count against that key&apos;s rate limit and appear in its usage. Playground tokens stop working as soon as
        the key is revoked.
      </P>

      <H2 id="authentication-errors">Authentication errors</H2>
      <DocTable
        caption="Authentication errors"
        columns={[{ header: "Status", className: "w-24" }, { header: "Code", className: "w-48" }, { header: "When" }]}
        rows={[
          ["401", <C key="c">INVALID_API_KEY</C>, "The header is missing, malformed, or the key does not exist."],
          ["401", <C key="c">INVALID_API_KEY</C>, <span key="d">The key has expired (<C>details.reason</C> is <C>&quot;expired&quot;</C>).</span>],
          ["403", <C key="c">API_KEY_REVOKED</C>, "The key was revoked."],
          [
            "403",
            <C key="c">ENDPOINT_NOT_ALLOWED</C>,
            <span key="d">
              The key is not allowed to call this endpoint (<C>details.allowed_endpoints</C> lists the ones it can call).
            </span>,
          ],
        ]}
      />
      <CodeBlock
        lang="json"
        title="401 Unauthorized"
        code={errorBody(
          "INVALID_API_KEY",
          "Missing API key. Send it in the Authorization header: 'Authorization: Bearer YOUR_API_KEY'.",
        )}
      />
    </DocsPage>
  );
}
