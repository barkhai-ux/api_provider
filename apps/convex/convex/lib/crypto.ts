/** Randomness and hashing helpers (Web Crypto). Generate secrets in actions only;
 * hashing (HMAC) also runs in mutations. */

const BASE62 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
// 248 = 62 * 4: bytes at or above it are rejected to avoid modulo bias.
const UNBIASED_LIMIT = 248;
const encoder = new TextEncoder();

export function randomString(length: number, alphabet: string = BASE62): string {
  const limit = alphabet === BASE62 ? UNBIASED_LIMIT : 256 - (256 % alphabet.length);
  const result: string[] = [];
  const bytes = new Uint8Array(length * 2);
  while (result.length < length) {
    crypto.getRandomValues(bytes);
    for (const byte of bytes) {
      if (byte < limit) {
        result.push(alphabet[byte % alphabet.length]);
        if (result.length === length) break;
      }
    }
  }
  return result.join("");
}

/**
 * HMAC-SHA256 as lowercase hex. Must match `hash_credential` in the API
 * gateway (apps/api/app/core/security.py).
 */
export async function hmacSha256Hex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Constant-time string comparison. */
export function timingSafeEqual(a: string, b: string): boolean {
  const left = encoder.encode(a);
  const right = encoder.encode(b);
  let diff = left.length ^ right.length;
  for (let i = 0; i < Math.max(left.length, right.length); i++) {
    diff |= (left[i] ?? 0) ^ (right[i] ?? 0);
  }
  return diff === 0;
}
