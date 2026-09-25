/**
 * Turns errors from Convex Auth and Convex functions into short, user-facing
 * messages. Raw server messages carry request ids and stack traces; only the
 * human part of a ConvexError is ever shown.
 */

export const GENERIC_ERROR = "Something went wrong. Please try again.";
export const NETWORK_ERROR = "Could not reach the server. Check your connection and try again.";
export const INVALID_CREDENTIALS = "The email or password is incorrect.";
export const TOO_MANY_ATTEMPTS = "Too many failed attempts. Wait a few minutes and try again.";
export const ACCOUNT_EXISTS = "An account with this email already exists. Sign in instead.";
export const INVALID_CODE = "That code is invalid or has expired. Request a new code and try again.";

function rawMessage(error: unknown): string {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") {
    return error.data;
  }
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "";
}

/** The message a ConvexError was thrown with, if the error contains one. */
export function convexErrorText(error: unknown): string | null {
  if (error && typeof error === "object" && "data" in error && typeof error.data === "string") {
    return error.data;
  }
  const match = /ConvexError: ([^\n]+)/.exec(rawMessage(error));
  return match ? match[1].trim() : null;
}

export function authErrorMessage(error: unknown): string {
  const message = rawMessage(error);
  if (/InvalidCredentials|InvalidAccountId|InvalidSecret|Invalid credentials/.test(message)) {
    return INVALID_CREDENTIALS;
  }
  if (/TooManyFailedAttempts/.test(message)) return TOO_MANY_ATTEMPTS;
  if (/already exists|AccountAlreadyExists/i.test(message)) return ACCOUNT_EXISTS;
  if (/Could not verify code|Invalid code|InvalidCode/i.test(message)) return INVALID_CODE;
  const convexText = convexErrorText(error);
  if (convexText) return convexText;
  if (isNetworkError(message)) return NETWORK_ERROR;
  return GENERIC_ERROR;
}

/** For dashboard mutations and actions: the ConvexError text, or a generic fallback. */
export function actionErrorMessage(error: unknown, fallback: string = GENERIC_ERROR): string {
  const convexText = convexErrorText(error);
  if (convexText) return convexText;
  if (isNetworkError(rawMessage(error))) return NETWORK_ERROR;
  return fallback;
}

export function isNetworkError(message: string): boolean {
  return /Failed to fetch|NetworkError|Network request failed|Load failed/i.test(message);
}

const REDIRECT_BASE = "https://same-origin.invalid";

/**
 * Only same-site paths are allowed as post-login destinations. The value is
 * resolved the way the browser would resolve it: browsers drop tabs and line
 * breaks from URLs, so "/\t/evil.example" would otherwise become
 * "//evil.example", a different site.
 */
export function safeNextPath(value: string | null | undefined, fallback = "/dashboard"): string {
  if (!value || !value.startsWith("/") || /[\u0000-\u001f\u007f\\]/.test(value)) return fallback;
  let url: URL;
  try {
    url = new URL(value, REDIRECT_BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== REDIRECT_BASE) return fallback;
  const path = `${url.pathname}${url.search}${url.hash}`;
  if (path.startsWith("//") || /^\/(login|register)(?:[/?#]|$)/.test(path)) return fallback;
  return path;
}
