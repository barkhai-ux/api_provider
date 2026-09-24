/**
 * Runs once when the Next.js server starts. Wakes the API gateway in the
 * background, so on hosts that stop idle services (such as Render's free plan)
 * the API starts while the first page loads, not on the first map search.
 */
export function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const apiUrl = process.env.API_INTERNAL_URL?.replace(/\/+$/, "");
  if (!apiUrl) return;
  fetch(`${apiUrl}/health`, { signal: AbortSignal.timeout(90_000) })
    .then((response) => response.body?.cancel())
    .catch(() => {});
}
