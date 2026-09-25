import { describe, expect, it } from "vitest";
import { internal } from "../convex/_generated/api";
import { isReservedEmail, validatePassword } from "../convex/auth";
import { isProduction } from "../convex/lib/env";
import { setup, signedInUser } from "./setup";

describe("system account", () => {
  it("is never an account someone registered with the system address", async () => {
    const t = setup();
    // An attacker signed up as platform@system.internal before the first deploy.
    await signedInUser(t, "platform@system.internal");
    await expect(t.mutation(internal.platform.upsertSystemUser, {})).rejects.toThrow(/reserved address/);
  });

  it("is found by its flag, not by email", async () => {
    const t = setup();
    const system = await t.run((ctx) => ctx.db.insert("users", { email: "platform@system.internal", isSystem: true }));
    expect(await t.mutation(internal.platform.upsertSystemUser, {})).toBe(system);
  });

  it("cannot use the dashboard even with a session", async () => {
    const t = setup();
    const impostor = await signedInUser(t, "someone@example.com");
    await t.run((ctx) => ctx.db.patch(impostor.userId, { isSystem: true }));
    const { api } = await import("../convex/_generated/api");
    await expect(impostor.as.query(api.apiKeys.list, {})).rejects.toThrow(/sign in/);
  });
});

describe("registration rules", () => {
  it("reserves internal and example domains", () => {
    for (const email of ["platform@system.internal", "x@host.local", "a@b.test", "a@b.invalid", "a@localhost.localhost"]) {
      expect(isReservedEmail(email)).toBe(true);
    }
    expect(isReservedEmail("dev@example.com")).toBe(false);
    expect(isReservedEmail("dev@company.mn")).toBe(false);
  });

  it("enforces length and refuses common or derived passwords", () => {
    expect(() => validatePassword("short")).toThrow(/between 10 and 128/);
    expect(() => validatePassword("x".repeat(129))).toThrow(/between 10 and 128/);
    for (const weak of ["1234567890", "Password123", "qwertyuiop", "aaaaaaaaaaaa", "abcabcabcabc", "ulaanbaatar1"]) {
      expect(() => validatePassword(weak)).toThrow(/too common/);
    }
    expect(() => validatePassword("batdorj!2024", "batdorj@company.mn")).toThrow(/too common/);
    expect(() => validatePassword("correct horse battery staple")).not.toThrow();
    // Length counts characters, not bytes (Cyrillic, emoji).
    expect(() => validatePassword("Нууцүгээ🔐🔐")).not.toThrow();
  });
});

describe("environment", () => {
  it("treats anything but development or test as production", () => {
    const original = process.env.ENVIRONMENT;
    try {
      for (const value of [undefined, "", "production", "prod", "staging", "Production"]) {
        if (value === undefined) delete process.env.ENVIRONMENT;
        else process.env.ENVIRONMENT = value;
        expect(isProduction()).toBe(true);
      }
      for (const value of ["development", "test", " Development "]) {
        process.env.ENVIRONMENT = value;
        expect(isProduction()).toBe(false);
      }
    } finally {
      process.env.ENVIRONMENT = original;
    }
  });
});

describe("incident response", () => {
  it("disabling an account revokes its keys and ends its sessions", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const key = await t.run((ctx) =>
      ctx.db.insert("apiKeys", { userId: alice.userId, name: "k", keyPrefix: "geo_abcd", keyHash: "d".repeat(64) }),
    );
    const result = await t.action(internal.admin.disableUser, { email: "Alice@Example.com" });
    expect(result.revokedKeys).toBe(1);
    const state = await t.run(async (ctx) => ({
      key: await ctx.db.get(key),
      user: await ctx.db.get(alice.userId),
      sessions: await ctx.db.query("authSessions").collect(),
    }));
    expect(state.key?.revokedAt).toBeDefined();
    expect(state.user?.disabledAt).toBeDefined();
    expect(state.sessions.filter((s) => s.userId === alice.userId)).toEqual([]);
  });

  it("refuses to disable the system account", async () => {
    const t = setup();
    await t.run((ctx) => ctx.db.insert("users", { email: "platform@system.internal", isSystem: true }));
    await expect(t.action(internal.admin.disableUser, { email: "platform@system.internal" })).rejects.toThrow(
      /system account/,
    );
  });
});
