import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, internalAction, internalMutation, internalQuery, mutation, query, type ActionCtx } from "./_generated/server";
import { requireUserId } from "./lib/session";
import { activePlan, freeRequestsRemaining, FREE_TOTAL_REQUESTS, hasKeyAccess, PAID_PLANS, PLAN_DURATION_MS, PLAN_WIRE_AMOUNT, PLAN_PRICE_MNT } from "./lib/plans";
import { WireApiError, wireRequest, type WireCheckoutSession, type WireIntent } from "./lib/wire";
import { isProduction } from "./lib/env";

const planValidator = v.union(v.literal("starter"), v.literal("essentials"), v.literal("pro"));

export const myBilling = query({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user) throw new ConvexError("Account not found.");
    const payments = await ctx.db
      .query("payments")
      .withIndex("by_user_status_created", (q) => q.eq("userId", userId).eq("status", "succeeded"))
      .order("desc")
      .take(20);
    return {
      plan: activePlan(user),
      planExpiresAt: activePlan(user) ? user.planExpiresAt : null,
      canUseApiKeys: hasKeyAccess(user),
      freeTier: {
        activated: user.freeTierActivatedAt !== undefined,
        remaining: freeRequestsRemaining(user),
        total: FREE_TOTAL_REQUESTS,
      },
      plans: PAID_PLANS,
      priceMnt: PLAN_PRICE_MNT,
      payments: payments.map(({ _id, plan, status, amountMinor, createdAt, paidAt }) => ({
        id: _id, plan, status, amountMinor, createdAt, paidAt: paidAt ?? null,
      })),
    };
  },
});

/** Each account can activate the 500-request testing tier once. */
export const activateFreeTier = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const user = await ctx.db.get(userId);
    if (!user || user.isSystem || user.disabledAt !== undefined) throw new ConvexError("Account not found.");
    if (user.freeTierActivatedAt !== undefined) return;
    await ctx.db.patch(userId, { freeTierActivatedAt: Date.now(), freeRequestsUsed: 0 });
  },
});

export const paymentStatus = query({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => {
    const userId = await requireUserId(ctx);
    const payment = await ctx.db.get(paymentId);
    if (!payment || payment.userId !== userId) throw new ConvexError("Payment not found.");
    return payment.status;
  },
});

export const _recordPending = internalMutation({
  args: { userId: v.id("users"), plan: planValidator, paymentIntentId: v.string() },
  handler: async (ctx, { userId, plan, paymentIntentId }) => {
    const existing = await ctx.db.query("payments")
      .withIndex("by_intent", (q) => q.eq("paymentIntentId", paymentIntentId)).unique();
    if (existing) {
      if (existing.userId !== userId || existing.plan !== plan) throw new Error("Payment intent already belongs to another checkout.");
      return existing._id;
    }
    return await ctx.db.insert("payments", {
      userId, plan, paymentIntentId, amountMinor: PLAN_WIRE_AMOUNT, currency: "MNT",
      status: "pending", createdAt: Date.now(),
    });
  },
});

export const _paymentForIntent = internalQuery({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, { paymentIntentId }) => await ctx.db
    .query("payments")
    .withIndex("by_intent", (q) => q.eq("paymentIntentId", paymentIntentId))
    .unique(),
});

export const _pending = internalQuery({
  args: {},
  handler: async (ctx) => await ctx.db
    .query("payments")
    .withIndex("by_status_created", (q) => q.eq("status", "pending"))
    .order("desc")
    .take(100),
});

/** The payment row is the idempotency gate for granting access. */
export const _settle = internalMutation({
  args: { paymentIntentId: v.string(), status: v.union(v.literal("succeeded"), v.literal("failed")), amount: v.number(), currency: v.string() },
  handler: async (ctx, args) => {
    const payment = await ctx.db.query("payments")
      .withIndex("by_intent", (q) => q.eq("paymentIntentId", args.paymentIntentId)).unique();
    if (!payment || payment.status !== "pending") return false;
    if (args.amount !== payment.amountMinor || args.currency !== payment.currency) return false;
    if (args.status === "failed") {
      await ctx.db.patch(payment._id, { status: "failed" });
      return true;
    }
    const user = await ctx.db.get(payment.userId);
    if (!user) return false;
    const now = Date.now();
    const existingExpiry = activePlan(user, now) ? user.planExpiresAt! : now;
    await ctx.db.patch(user._id, { plan: payment.plan, planExpiresAt: existingExpiry + PLAN_DURATION_MS });
    await ctx.db.patch(payment._id, { status: "succeeded", paidAt: now });
    return true;
  },
});

export const _userForCheckout = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user && !user.disabledAt && !user.isSystem ? { id: userId } : null;
  },
});

async function checkIntent(ctx: ActionCtx, paymentIntentId: string): Promise<string> {
  const intent = await wireRequest<WireIntent>(`/v1/payment_intents/${encodeURIComponent(paymentIntentId)}`);
  if (intent.id !== paymentIntentId) throw new Error("Wire returned an unexpected payment intent.");
  if (intent.status === "succeeded") {
    await ctx.runMutation(internal.payments._settle, { paymentIntentId, status: "succeeded", amount: intent.amount, currency: intent.currency });
  } else if (["failed", "canceled", "expired"].includes(intent.status)) {
    await ctx.runMutation(internal.payments._settle, { paymentIntentId, status: "failed", amount: intent.amount, currency: intent.currency });
  }
  return intent.status;
}

function trustedCheckoutUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "https:" || url.hostname !== "pay.wire.mn" || !url.pathname.startsWith("/c/")) {
    throw new Error("Wire returned an invalid checkout URL.");
  }
  return url.toString();
}

/** Create a Wire-hosted checkout with QPay QR and bank-app deeplinks. */
export const startCheckout = action({
  args: { plan: planValidator, requestId: v.string() },
  handler: async (ctx, { plan, requestId }): Promise<
    { status: "ready"; paymentId: Id<"payments">; nextAction: unknown } | { status: "unavailable" }
  > => {
    const userId = await requireUserId(ctx);
    if (!/^[a-f\d]{8}-[a-f\d]{4}-[1-8][a-f\d]{3}-[89ab][a-f\d]{3}-[a-f\d]{12}$/i.test(requestId)) {
      throw new ConvexError("Invalid checkout request.");
    }
    if (!(await ctx.runQuery(internal.payments._userForCheckout, { userId }))) throw new ConvexError("Account not found.");
    const key = process.env.WIREPAYMENT_SECRET_KEY;
    if (!key) throw new ConvexError("Payments are not configured yet.");
    if (isProduction() && key.startsWith("sk_test_")) throw new ConvexError("Live payments are not configured yet.");
    const reference = requestId;
    let intent: WireIntent;
    try {
      intent = await wireRequest<WireIntent>("/v1/payment_intents", {
        method: "POST", idempotencyKey: `plan-${reference}`,
        body: {
          amount: PLAN_WIRE_AMOUNT, currency: "MNT", description: `Ubhub ${plan} ${reference.slice(0, 8)}`,
          automatic_operator: true,
          ...(key.startsWith("sk_test_") ? { allowed_operators: ["sandbox"] } : {}),
          metadata: { userId: String(userId), plan },
        },
      });
    } catch (error) {
      if (error instanceof WireApiError && [
        "connector_required", "settlement_account_required", "dan_verification_required",
      ].includes(error.code)) {
        console.warn("wire_checkout_unavailable", { code: error.code, requestId: error.requestId });
        return { status: "unavailable" };
      }
      throw error;
    }
    if (!intent.id || intent.amount !== PLAN_WIRE_AMOUNT || intent.currency !== "MNT") throw new Error("Invalid Wire payment intent.");
    const paymentId = await ctx.runMutation(internal.payments._recordPending, { userId, plan, paymentIntentId: intent.id });
    const siteUrl = process.env.SITE_URL;
    const billingUrl = siteUrl ? new URL("/dashboard/billing", siteUrl).toString() : undefined;
    const session = await wireRequest<WireCheckoutSession>("/v1/checkout/sessions", {
      method: "POST", idempotencyKey: `checkout-${reference}`,
      body: {
        payment_intent: intent.id,
        ...(billingUrl ? { success_url: billingUrl, cancel_url: billingUrl } : {}),
      },
    });
    if (!session.id || session.payment_intent !== intent.id) throw new Error("Invalid Wire checkout session.");
    return {
      status: "ready",
      paymentId,
      nextAction: { redirect_to_url: { url: trustedCheckoutUrl(session.url) } },
    };
  },
});

export const refreshPayment = action({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }): Promise<string> => {
    const userId = await requireUserId(ctx);
    const payment = await ctx.runQuery(internal.payments._paymentById, { paymentId });
    if (!payment || payment.userId !== userId) throw new ConvexError("Payment not found.");
    if (payment.status !== "pending") return payment.status;
    await checkIntent(ctx, payment.paymentIntentId);
    return "checked";
  },
});

export const _paymentById = internalQuery({
  args: { paymentId: v.id("payments") },
  handler: async (ctx, { paymentId }) => await ctx.db.get(paymentId),
});

export const settleFromWebhook = internalAction({
  args: { paymentIntentId: v.string() },
  handler: async (ctx, { paymentIntentId }): Promise<string> => await checkIntent(ctx, paymentIntentId),
});

export const reconcilePending = internalAction({
  args: {},
  handler: async (ctx): Promise<void> => {
    const pending = await ctx.runQuery(internal.payments._pending, {});
    for (const payment of pending) {
      try { await checkIntent(ctx, payment.paymentIntentId); }
      catch { /* Retry on the next run. */ }
    }
  },
});

export { PAID_PLANS };
