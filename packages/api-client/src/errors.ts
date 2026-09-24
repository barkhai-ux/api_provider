import type { ErrorCode } from "@geo-platform/types";

export interface RateLimitInfo {
  /** Requests allowed per window (one minute). */
  limit: number;
  /** Requests left in the current window. */
  remaining: number;
  /** Unix time (seconds) when the window resets. */
  reset: number;
}

/** Client-side failures that never reached the API. */
export type ClientErrorCode = "NETWORK_ERROR" | "INVALID_RESPONSE";

/** Thrown for every non-2xx response and for network failures. */
export class GeoApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | ClientErrorCode;
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;
  readonly rateLimit: RateLimitInfo | undefined;

  constructor(init: {
    status: number;
    code: ErrorCode | ClientErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
    rateLimit?: RateLimitInfo;
  }) {
    super(init.message);
    this.name = "GeoApiError";
    this.status = init.status;
    this.code = init.code;
    this.details = init.details;
    this.requestId = init.requestId;
    this.rateLimit = init.rateLimit;
  }

  /** True when retrying later may succeed (rate limits, timeouts, upstream trouble). */
  get retryable(): boolean {
    return (
      this.code === "RATE_LIMIT_EXCEEDED" ||
      this.code === "REQUEST_TIMEOUT" ||
      this.code === "UPSTREAM_ERROR" ||
      this.code === "SERVICE_UNAVAILABLE" ||
      this.code === "NETWORK_ERROR"
    );
  }
}
