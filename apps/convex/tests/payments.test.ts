import { afterEach, describe, expect, it, vi } from "vitest";
import { api, internal } from "../convex/_generated/api";
import { PLAN_WIRE_AMOUNT } from "../convex/lib/plans";
import { verifyWireSignature } from "../convex/lib/wire";
import { setup, signedInUser } from "./setup";

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.WIREPAYMENT_SECRET_KEY;
});

describe("Wire payments", () => {
  it("creates an account-bound ₮1,000 QPay payment", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    process.env.WIREPAYMENT_SECRET_KEY = "sk_test_example";
    const calls: { url: string; init: RequestInit }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      if (calls.length === 1) return Response.json({ id: "pi_test", amount: PLAN_WIRE_AMOUNT, currency: "MNT", status: "requires_payment_method" });
      return Response.json({
        id: "pi_test", amount: PLAN_WIRE_AMOUNT, currency: "MNT", status: "requires_action",
        next_action: { type: "qr", qr: { text: "qpay-test", deeplinks: [] } },
      });
    }));

    const checkout = await alice.as.action(api.payments.startCheckout, {
      plan: "pro", requestId: "4b52e335-f398-4f3e-8887-179130740572",
    });
    expect(checkout.status).toBe("ready");
    if (checkout.status !== "ready") throw new Error("Expected ready checkout");
    expect(checkout.nextAction).toEqual({ type: "qr", qr: { text: "qpay-test", deeplinks: [] } });
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      amount: 1_000, currency: "MNT", allowed_operators: ["sandbox"],
      metadata: { userId: alice.userId, plan: "pro" },
    });
    expect(calls.map((call) => call.init.headers)).toEqual([
      expect.objectContaining({ "Idempotency-Key": "plan-4b52e335-f398-4f3e-8887-179130740572" }),
      expect.objectContaining({ "Idempotency-Key": "confirm-4b52e335-f398-4f3e-8887-179130740572" }),
    ]);
    expect(calls[1]!.url).toBe("https://api.wire.mn/v1/payment_intents/pi_test/confirm");
    expect(calls[1]!.init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({});
    const billing = await alice.as.query(api.payments.myBilling, {});
    expect(billing.payments).toEqual([]);
  });

  it("returns an unavailable state when Wire requires an operator connection", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    process.env.WIREPAYMENT_SECRET_KEY = "sk_live_example";
    const fetchMock = vi.fn(async () => Response.json({
      error: { code: "connector_required", request_id: "req_test" },
    }, { status: 403 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await alice.as.action(api.payments.startCheckout, {
      plan: "starter", requestId: "4b52e335-f398-4f3e-8887-179130740572",
    });
    expect(result).toEqual({ status: "unavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((await alice.as.query(api.payments.myBilling, {})).payments).toEqual([]);
  });

  it("grants a plan exactly once, only for the matching paid amount", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    const bob = await signedInUser(t, "bob@example.com");
    const paymentId = await t.mutation(internal.payments._recordPending, {
      userId: alice.userId, plan: "essentials", paymentIntentId: "pi_1",
    });
    await expect(bob.as.query(api.payments.paymentStatus, { paymentId })).rejects.toThrow(/not found/);
    expect(await t.mutation(internal.payments._settle, {
      paymentIntentId: "pi_1", status: "succeeded", amount: 1, currency: "MNT",
    })).toBe(false);
    expect((await alice.as.query(api.payments.myBilling, {})).plan).toBe(null);
    expect(await t.mutation(internal.payments._settle, {
      paymentIntentId: "pi_1", status: "succeeded", amount: PLAN_WIRE_AMOUNT, currency: "MNT",
    })).toBe(true);
    const paid = await alice.as.query(api.payments.myBilling, {});
    expect(paid.plan).toBe("essentials");
    expect(paid.payments[0]?.status).toBe("succeeded");
    expect(await t.mutation(internal.payments._settle, {
      paymentIntentId: "pi_1", status: "succeeded", amount: PLAN_WIRE_AMOUNT, currency: "MNT",
    })).toBe(false);
    expect((await alice.as.query(api.payments.myBilling, {})).planExpiresAt).toBe(paid.planExpiresAt);
  });

  it("shows completed payments even when newer checkouts are pending", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await t.mutation(internal.payments._recordPending, {
      userId: alice.userId, plan: "starter", paymentIntentId: "paid-intent",
    });
    await t.mutation(internal.payments._settle, {
      paymentIntentId: "paid-intent", status: "succeeded", amount: PLAN_WIRE_AMOUNT, currency: "MNT",
    });
    for (let i = 0; i < 21; i++) {
      await t.mutation(internal.payments._recordPending, {
        userId: alice.userId, plan: "starter", paymentIntentId: `pending-${i}`,
      });
    }
    const history = (await alice.as.query(api.payments.myBilling, {})).payments;
    expect(history).toHaveLength(1);
    expect(history[0]?.status).toBe("succeeded");
  });

  it("settles a webhook only after fetching a matching successful intent from Wire", async () => {
    const t = setup();
    const alice = await signedInUser(t, "alice@example.com");
    await t.mutation(internal.payments._recordPending, {
      userId: alice.userId, plan: "starter", paymentIntentId: "pi_confirmed",
    });
    process.env.WIREPAYMENT_SECRET_KEY = "sk_test_example";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      id: "pi_confirmed", status: "succeeded", amount: PLAN_WIRE_AMOUNT, currency: "MNT",
    })));
    await t.action(internal.payments.settleFromWebhook, { paymentIntentId: "pi_confirmed" });
    expect((await alice.as.query(api.payments.myBilling, {})).plan).toBe("starter");
  });

  it("rejects tampered or old webhook signatures", async () => {
    const body = JSON.stringify({ type: "payment_intent.succeeded" });
    const secret = "whsec_test";
    const now = 1_717_000_000_000;
    const timestamp = String(now / 1_000);
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const bytes = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${body}`)));
    const signature = Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
    const header = `t=${timestamp},v1=${signature}`;
    expect(await verifyWireSignature(body, header, secret, now)).toBe(true);
    expect(await verifyWireSignature(`${body} `, header, secret, now)).toBe(false);
    expect(await verifyWireSignature(body, header, secret, now + 301_000)).toBe(false);
  });
});
