/**
 * The /gateway HTTP actions and the functions behind them. The API gateway is
 * authenticated with GATEWAY_SECRET, but its input is still checked: a bug or
 * a leaked secret must not let one tenant's data be written as another's.
 */
import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { GATEWAY_SECRET, insertKey, setup, signedInUser } from "./setup";

const HASH = "a".repeat(64);

function authorizeArgs(overrides: Record<string, unknown> = {}) {
  return { kind: "key" as const, hash: HASH, endpoint: "geocode", defaultLimit: 100, ...overrides };
}

describe("gateway authorize", () => {
  it("refuses keys that are limited to other endpoints, without counting them", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await insertKey(t, alice.userId, { keyHash: HASH, endpoints: ["geocode"] });
    const refused = await t.mutation(internal.gateway.authorize, authorizeArgs({ endpoint: "route" }));
    expect(refused.status).toBe("endpoint_not_allowed");
    const missing = await t.mutation(internal.gateway.authorize, authorizeArgs({ endpoint: undefined }));
    expect(missing.status).toBe("endpoint_not_allowed");
    const windows = await t.run((ctx) => ctx.db.query("rateLimitWindows").collect());
    expect(windows).toEqual([]);
    expect((await t.mutation(internal.gateway.authorize, authorizeArgs())).status).toBe("ok");
  });

  it("limits an account across all of its keys", async () => {
    const t = setup();
    process.env.ACCOUNT_RATE_LIMIT_PER_MINUTE = "3";
    const alice = await signedInUser(t, "alice@example.com");
    await insertKey(t, alice.userId, { keyHash: "b".repeat(64), rateLimitPerMinute: 2 });
    await insertKey(t, alice.userId, { keyHash: "c".repeat(64), rateLimitPerMinute: 2 });
    const statuses = [];
    for (const hash of ["b", "b", "c", "c"]) {
      statuses.push((await t.mutation(internal.gateway.authorize, authorizeArgs({ hash: hash.repeat(64) }))).status);
    }
    // Each key is under its own limit of 2, but the account allows only
    // max(2, 3) = 3 requests per minute in total.
    expect(statuses).toEqual(["ok", "ok", "ok", "rate_limited"]);
  });

  it("gives routing its own lower limit", async () => {
    const t = setup();
    process.env.ROUTE_RATE_LIMIT_PER_MINUTE = "2";
    const alice = await signedInUser(t, "alice@example.com");
    await insertKey(t, alice.userId, { keyHash: HASH });
    const route = [];
    for (let i = 0; i < 3; i++) {
      route.push((await t.mutation(internal.gateway.authorize, authorizeArgs({ endpoint: "route" }))).status);
    }
    expect(route).toEqual(["ok", "ok", "rate_limited"]);
    expect((await t.mutation(internal.gateway.authorize, authorizeArgs({ endpoint: "geocode" }))).status).toBe("ok");
  });

  it("limits the site key per visitor and stores only hashed IPs", async () => {
    const t = setup();
    const system = await t.run((ctx) => ctx.db.insert("users", { email: "platform@system.internal", isSystem: true }));
    await insertKey(t, system, { keyHash: HASH, isSiteKey: true, rateLimitPerMinute: 10_000 });
    const visitor = (ip: string) => authorizeArgs({ clientIp: ip, perIpLimit: 2 });
    const first = [];
    for (let i = 0; i < 3; i++) first.push((await t.mutation(internal.gateway.authorize, visitor("203.0.113.9"))).status);
    expect(first).toEqual(["ok", "ok", "rate_limited"]);
    expect((await t.mutation(internal.gateway.authorize, visitor("198.51.100.7"))).status).toBe("ok");
    const buckets = (await t.run((ctx) => ctx.db.query("rateLimitWindows").collect())).map((w) => w.bucket);
    expect(buckets.join(" ")).not.toContain("203.0.113.9");
    expect(buckets.join(" ")).not.toContain("198.51.100.7");
    // A garbage "IP" does not open a fresh bucket per value.
    const junk = [];
    for (let i = 0; i < 3; i++) junk.push((await t.mutation(internal.gateway.authorize, visitor(`<script>${i}`))).status);
    expect(junk).toEqual(["ok", "ok", "rate_limited"]);
  });

  it("caps the site key overall, whatever the visitor addresses", async () => {
    const t = setup();
    const system = await t.run((ctx) => ctx.db.insert("users", { email: "platform@system.internal", isSystem: true }));
    await insertKey(t, system, { keyHash: HASH, isSiteKey: true, rateLimitPerMinute: 3 });
    const statuses = [];
    for (let i = 0; i < 4; i++) {
      statuses.push((await t.mutation(internal.gateway.authorize, authorizeArgs({ clientIp: `203.0.113.${i}`, perIpLimit: 60 }))).status);
    }
    expect(statuses).toEqual(["ok", "ok", "ok", "rate_limited"]);
  });

  it("treats keys of disabled accounts as revoked", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await insertKey(t, alice.userId, { keyHash: HASH });
    await t.run((ctx) => ctx.db.patch(alice.userId, { disabledAt: Date.now() }));
    expect((await t.mutation(internal.gateway.authorize, authorizeArgs())).status).toBe("revoked");
  });

  it("rejects expired keys", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await insertKey(t, alice.userId, { keyHash: HASH, expiresAt: Date.now() - 1 });
    expect((await t.mutation(internal.gateway.authorize, authorizeArgs())).status).toBe("expired");
  });
});

describe("gateway recordUsage", () => {
  it("takes the owner from the key and drops implausible records", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const bob = await signedInUser(t, "bob@example.com");
    const aliceKey = await insertKey(t, alice.userId);
    const now = Date.now();
    const base = { keyId: aliceKey, userId: alice.userId, endpoint: "/v1/geocode", method: "GET", statusCode: 200, responseTimeMs: 5, timestamp: now };
    const result = await t.mutation(internal.gateway.recordUsage, {
      entries: [
        base,
        { ...base, userId: bob.userId }, // Alice's key attributed to Bob
        { ...base, keyId: "not-an-id" },
        { ...base, endpoint: "/v1/../admin" },
        { ...base, method: "DELETE" },
        { ...base, statusCode: 1000 },
        { ...base, timestamp: now + 3_600_000 }, // in the future
        { ...base, timestamp: 9e15 },
      ],
    });
    expect(result).toEqual({ written: 1, dropped: 7 });
    const rows = await t.run((ctx) => ctx.db.query("apiRequests").collect());
    expect(rows).toHaveLength(1);
    expect(rows[0]?.userId).toBe(alice.userId);
    const key = await t.run((ctx) => ctx.db.get(aliceKey));
    expect(key?.lastUsedAt).toBeLessThanOrEqual(Date.now());
  });
});

describe("gateway HTTP actions", () => {
  const auth = (secret: string) => ({ Authorization: `Bearer ${secret}`, "Content-Type": "application/json" });

  it("require the gateway secret", async () => {
    const t = setup();
    expect((await t.fetch("/gateway/health")).status).toBe(401);
    expect((await t.fetch("/gateway/health", { headers: auth("wrong") })).status).toBe(401);
    expect((await t.fetch("/gateway/health", { headers: { Authorization: GATEWAY_SECRET } })).status).toBe(401);
    expect((await t.fetch("/gateway/health", { headers: auth(GATEWAY_SECRET) })).status).toBe(200);
  });

  it("accept the previous secret during a rotation, and never a short one", async () => {
    const t = setup();
    const previous = "previous-gateway-secret-0123456789abcdefghij";
    process.env.GATEWAY_SECRET_PREVIOUS = previous;
    expect((await t.fetch("/gateway/health", { headers: auth(previous) })).status).toBe(200);
    process.env.GATEWAY_SECRET = "short";
    expect((await t.fetch("/gateway/health", { headers: auth("short") })).status).toBe(401);
  });

  it("reject malformed bodies with 400", async () => {
    const t = setup();
    for (const body of ["null", "[]", "{not json", JSON.stringify({ kind: "key", hash: "zz" })]) {
      const response = await t.fetch("/gateway/authorize", { method: "POST", headers: auth(GATEWAY_SECRET), body });
      expect(response.status).toBe(400);
    }
    const tooMany = JSON.stringify({ entries: Array.from({ length: 1001 }, () => ({})) });
    const response = await t.fetch("/gateway/usage", { method: "POST", headers: auth(GATEWAY_SECRET), body: tooMany });
    expect(response.status).toBe(400);
  });
});
