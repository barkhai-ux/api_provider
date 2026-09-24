import { convexAuthNextjsToken } from "@convex-dev/auth/nextjs/server";
import { api } from "@geo-platform/convex/api";
import { fetchQuery } from "convex/nextjs";
import { serverEnv } from "@/lib/server-env";

/** Tells public pages whether a developer is signed in (used by the header). */
export async function GET() {
  const noStore = { headers: { "Cache-Control": "private, no-store" } };
  const token = await convexAuthNextjsToken();
  if (!token) return Response.json({ authenticated: false }, noStore);
  try {
    const viewer = await fetchQuery(api.users.viewer, {}, { token, url: serverEnv().convexUrl });
    if (viewer === null) return Response.json({ authenticated: false }, noStore);
    return Response.json({ authenticated: true, user: { name: viewer.name, email: viewer.email } }, noStore);
  } catch {
    return Response.json({ authenticated: false }, noStore);
  }
}
