/**
 * Every public function must act only on the signed-in user's own data, and
 * only while the session is still active. Each case is an attack a malicious
 * registered developer could try with IDs taken from their own account or
 * guessed from another one.
 */
import { describe, expect, it } from "vitest";
import { api } from "../convex/_generated/api";
import { insertKey, setup, signedInUser } from "./setup";

describe("tenant isolation (IDOR)", () => {
  it("user A cannot rename, revoke or regenerate user B's key", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const bob = await signedInUser(t, "bob@example.com");
    const bobKey = await insertKey(t, bob.userId);

    await expect(alice.as.mutation(api.apiKeys.rename, { keyId: bobKey, name: "mine now" })).rejects.toThrow(
      /API key not found/,
    );
    await expect(alice.as.mutation(api.apiKeys.revoke, { keyId: bobKey })).rejects.toThrow(/API key not found/);
    await expect(alice.as.action(api.apiKeys.regenerate, { keyId: bobKey })).rejects.toThrow(/API key not found/);
    await expect(alice.as.action(api.apiKeys.createPlaygroundToken, { keyId: bobKey })).rejects.toThrow(
      /API key not found/,
    );

    const key = await t.run((ctx) => ctx.db.get(bobKey));
    expect(key?.name).toBe("Key");
    expect(key?.revokedAt).toBeUndefined();
  });

  it("user A's key list and usage never include user B's data", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const bob = await signedInUser(t, "bob@example.com");
    const bobKey = await insertKey(t, bob.userId);
    await t.run(async (ctx) => {
      await ctx.db.insert("apiRequests", {
        apiKeyId: bobKey,
        userId: bob.userId,
        endpoint: "/v1/geocode",
        method: "GET",
        statusCode: 200,
        responseTimeMs: 12,
        timestamp: Date.now(),
      });
    });

    expect(await alice.as.query(api.apiKeys.list, {})).toEqual([]);
    const summary = await alice.as.query(api.usage.summary, {});
    expect(summary.month.total).toBe(0);
    const daily = await alice.as.query(api.usage.daily, { days: 7, keyId: bobKey });
    expect(daily.every((day) => day.total === 0)).toBe(true);
    expect(await alice.as.query(api.usage.endpoints, { days: 7, keyId: bobKey })).toEqual([]);
    // Asking for another user's key by ID is refused outright, so not even the
    // page metadata (whether more rows exist) leaks.
    await expect(
      alice.as.query(api.usage.recent, { keyId: bobKey, paginationOpts: { numItems: 10, cursor: null } }),
    ).rejects.toThrow(/API key not found/);
  });

  it("caps page sizes", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const page = await alice.as.query(api.usage.recent, { paginationOpts: { numItems: 1_000_000, cursor: null } });
    expect(page.page).toEqual([]);
  });
});

describe("sessions", () => {
  it("stops working as soon as the session is deleted (sign-out, password change)", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    expect(await alice.as.query(api.apiKeys.list, {})).toEqual([]);
    await t.run((ctx) => ctx.db.delete(alice.sessionId));
    // The access token (JWT) is still "valid", but the session behind it is gone.
    await expect(alice.as.query(api.apiKeys.list, {})).rejects.toThrow(/sign in/);
    expect(await alice.as.query(api.users.viewer, {})).toBeNull();
  });

  it("refuses expired sessions and disabled accounts", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await t.run((ctx) => ctx.db.patch(alice.sessionId, { expirationTime: Date.now() - 1 }));
    await expect(alice.as.query(api.apiKeys.list, {})).rejects.toThrow(/sign in/);

    const bob = await signedInUser(t, "bob@example.com");
    await t.run((ctx) => ctx.db.patch(bob.userId, { disabledAt: Date.now() }));
    await expect(bob.as.mutation(api.users.updateProfile, { name: "Bob" })).rejects.toThrow(/sign in/);
  });

  it("does not accept a session that belongs to another user", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const bob = await signedInUser(t, "bob@example.com");
    const forged = t.withIdentity({ subject: `${alice.userId}|${bob.sessionId}` });
    await expect(forged.query(api.apiKeys.list, {})).rejects.toThrow(/sign in/);
  });

  it("requires sign-in for every dashboard function", async () => {
    const t = setup();
    await expect(t.query(api.apiKeys.list, {})).rejects.toThrow(/sign in/);
    await expect(t.query(api.usage.summary, {})).rejects.toThrow(/sign in/);
    await expect(t.action(api.apiKeys.create, { name: "x" })).rejects.toThrow(/sign in/);
    expect(await t.query(api.users.viewer, {})).toBeNull();
  });
});

describe("API keys", () => {
  it("rejects expiry dates in the past or too far ahead", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await expect(alice.as.action(api.apiKeys.create, { name: "x", expiresAt: Date.now() - 1000 })).rejects.toThrow(
      /future/,
    );
    await expect(
      alice.as.action(api.apiKeys.create, { name: "x", expiresAt: Date.now() + 10 * 366 * 86_400_000 }),
    ).rejects.toThrow(/5 years/);
    await expect(alice.as.action(api.apiKeys.create, { name: "x", endpoints: [] })).rejects.toThrow(/at least one/);
  });

  it("creates keys with a random secret that is never stored", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const created = await alice.as.action(api.apiKeys.create, { name: "Server", endpoints: ["geocode"] });
    expect(created.secret).toMatch(/^geo_[A-Za-z0-9]{32}$/);
    const stored = await t.run((ctx) => ctx.db.get(created.id));
    expect(JSON.stringify(stored)).not.toContain(created.secret.slice(4));
    expect(stored?.keyHash).toMatch(/^[0-9a-f]{64}$/);
    expect(stored?.endpoints).toEqual(["geocode"]);
  });

  it("does not issue playground tokens for expired keys, and keeps few per key", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const expired = await insertKey(t, alice.userId, { expiresAt: Date.now() - 1000 });
    await expect(alice.as.action(api.apiKeys.createPlaygroundToken, { keyId: expired })).rejects.toThrow(/expired/);

    const key = await insertKey(t, alice.userId);
    for (let i = 0; i < 12; i++) await alice.as.action(api.apiKeys.createPlaygroundToken, { keyId: key });
    const tokens = await t.run((ctx) =>
      ctx.db
        .query("playgroundTokens")
        .withIndex("by_key", (q) => q.eq("apiKeyId", key))
        .collect(),
    );
    expect(tokens.length).toBeLessThanOrEqual(5);
  });

  it("revoking or regenerating a key deletes its playground tokens", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const key = await insertKey(t, alice.userId);
    await alice.as.action(api.apiKeys.createPlaygroundToken, { keyId: key });
    await alice.as.action(api.apiKeys.regenerate, { keyId: key });
    const count = async () =>
      (
        await t.run((ctx) =>
          ctx.db
            .query("playgroundTokens")
            .withIndex("by_key", (q) => q.eq("apiKeyId", key))
            .collect(),
        )
      ).length;
    expect(await count()).toBe(0);
    await alice.as.action(api.apiKeys.createPlaygroundToken, { keyId: key });
    await alice.as.mutation(api.apiKeys.revoke, { keyId: key });
    expect(await count()).toBe(0);
  });
});
