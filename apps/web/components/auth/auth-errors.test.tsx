import { describe, expect, it } from "vitest";
import {
  ACCOUNT_EXISTS,
  GENERIC_ERROR,
  INVALID_CODE,
  INVALID_CREDENTIALS,
  NETWORK_ERROR,
  TOO_MANY_ATTEMPTS,
  actionErrorMessage,
  authErrorMessage,
  safeNextPath,
} from "@/lib/auth-errors";

describe("authErrorMessage", () => {
  it("maps Convex Auth failures to friendly text", () => {
    expect(authErrorMessage(new Error("InvalidCredentials"))).toBe(INVALID_CREDENTIALS);
    expect(authErrorMessage(new Error("TooManyFailedAttempts"))).toBe(TOO_MANY_ATTEMPTS);
    expect(authErrorMessage(new Error("Uncaught Error: Account a@b.co already exists\n at x"))).toBe(ACCOUNT_EXISTS);
    expect(authErrorMessage(new Error("[Request ID: 1] Server Error\nUncaught Error: Could not verify code"))).toBe(INVALID_CODE);
    expect(authErrorMessage(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR);
    expect(authErrorMessage(new Error("boom"))).toBe(GENERIC_ERROR);
  });

  it("shows only the human part of a ConvexError", () => {
    const error = new Error(
      "[Request ID: f5e8] Server Error\nUncaught ConvexError: Enter a valid email address.\n    at profile (../../convex/auth.ts:30:19)",
    );
    expect(authErrorMessage(error)).toBe("Enter a valid email address.");
    expect(actionErrorMessage({ data: "API key not found." })).toBe("API key not found.");
  });
});

describe("safeNextPath", () => {
  it("allows only same-site relative paths", () => {
    expect(safeNextPath("/dashboard/usage")).toBe("/dashboard/usage");
    expect(safeNextPath("//evil.example")).toBe("/dashboard");
    expect(safeNextPath("/\\evil.example")).toBe("/dashboard");
    expect(safeNextPath("https://evil.example")).toBe("/dashboard");
    expect(safeNextPath(null)).toBe("/dashboard");
    expect(safeNextPath("/login")).toBe("/dashboard");
  });
});
