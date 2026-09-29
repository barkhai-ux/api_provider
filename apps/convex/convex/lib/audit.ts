import type { Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";

export type AuditSeverity = "INFO" | "WARNING" | "HIGH" | "CRITICAL";

/** Append one bounded event. Callers pass identifiers resolved from trusted
 * database records; secrets, request parameters and raw client addresses are
 * never accepted by this API. */
export async function writeAudit(
  ctx: MutationCtx,
  event: string,
  severity: AuditSeverity,
  outcome: "success" | "failure",
  fields: { tenantId?: Id<"users">; apiKeyId?: Id<"apiKeys">; detail?: string } = {},
): Promise<void> {
  await ctx.db.insert("securityAuditEvents", {
    event: event.slice(0, 80),
    severity,
    outcome,
    ...(fields.tenantId ? { tenantId: fields.tenantId } : {}),
    ...(fields.apiKeyId ? { apiKeyId: fields.apiKeyId } : {}),
    ...(fields.detail ? { detail: fields.detail.slice(0, 120) } : {}),
    timestamp: Date.now(),
  });
}
