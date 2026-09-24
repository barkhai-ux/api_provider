/**
 * Sign-out for pages that do not load the Convex client (public pages). Goes
 * through the same /api/auth proxy that Convex Auth uses, which clears the
 * httpOnly session cookies.
 */
export async function signOutViaProxy(): Promise<void> {
  await fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "auth:signOut", args: {} }),
  });
}
