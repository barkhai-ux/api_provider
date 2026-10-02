/** Server-only Wire merchant API and webhook helpers. */
const API_BASE = "https://api.wire.mn";

export type WireIntent = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  livemode: boolean;
  next_action?: unknown;
};

export class WireApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly requestId: string | null,
  ) {
    super(`Wire payment request failed (${status}, ${code}).`);
    this.name = "WireApiError";
  }
}

export async function wireRequest<T>(
  path: string,
  options: { method?: "GET" | "POST"; body?: Record<string, unknown>; idempotencyKey?: string } = {},
): Promise<T> {
  const secret = process.env.WIREPAYMENT_SECRET_KEY;
  if (!secret) throw new Error("WIREPAYMENT_SECRET_KEY is not configured.");
  const response = await fetch(`${API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(options.idempotencyKey ? { "Idempotency-Key": options.idempotencyKey } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10_000),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const error = body && typeof body === "object" && "error" in body ? body.error : null;
    const details = error && typeof error === "object" ? error as Record<string, unknown> : {};
    const code = typeof details.code === "string" ? details.code : "request_failed";
    const requestId = typeof details.request_id === "string" ? details.request_id : null;
    throw new WireApiError(response.status, code, requestId);
  }
  return body as T;
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index++) diff |= a[index]! ^ b[index]!;
  return diff === 0;
}

export async function verifyWireSignature(
  body: string,
  header: string | null,
  secret: string,
  nowMs = Date.now(),
): Promise<boolean> {
  if (!header || !secret) return false;
  const entries = header.split(",").map((entry) => entry.trim().split("="));
  const timestamp = entries.find(([name]) => name === "t")?.[1];
  const signature = entries.find(([name]) => name === "v1")?.[1];
  if (!timestamp || !/^\d+$/.test(timestamp) || !signature || !/^[a-f\d]{64}$/i.test(signature)) return false;
  const seconds = Number(timestamp);
  if (!Number.isSafeInteger(seconds) || Math.abs(nowMs / 1000 - seconds) > 300) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const expected = new Uint8Array(
    await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)),
  );
  const actual = new Uint8Array(signature.match(/../g)!.map((pair) => Number.parseInt(pair, 16)));
  return timingSafeEqual(actual, expected);
}
