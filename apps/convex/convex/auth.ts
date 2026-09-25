import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError, type Value } from "convex/values";
import { isCommonPassword } from "./lib/commonPasswords";
import { PasswordReset } from "./lib/passwordReset";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Addresses nobody may register: the platform's own account and internal domains. */
const RESERVED_EMAIL_DOMAINS = [".internal", ".local", ".localhost", ".invalid", ".test", ".example"];

export function normalizeEmail(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export function isReservedEmail(email: string): boolean {
  const domain = email.slice(email.lastIndexOf("@") + 1);
  return RESERVED_EMAIL_DOMAINS.some((suffix) => domain.endsWith(suffix));
}

/**
 * Length-based policy per NIST SP 800-63B: 10 to 128 characters, any
 * characters allowed, no composition rules, and a check against common and
 * trivially guessable passwords (including ones built from the email address).
 */
export function validatePassword(password: string, email?: string): void {
  if (typeof password !== "string") throw new ConvexError("Enter a password.");
  const length = [...password].length;
  if (length < MIN_PASSWORD_LENGTH || length > MAX_PASSWORD_LENGTH) {
    throw new ConvexError(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
  if (isCommonPassword(password, email)) {
    throw new ConvexError("This password is too common or easy to guess. Choose a different one.");
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = normalizeEmail(params.email);
        if (!EMAIL_PATTERN.test(email) || email.length > 320 || isReservedEmail(email)) {
          throw new ConvexError("Enter a valid email address.");
        }
        // New passwords are checked again here, where the email is known, so
        // passwords built from the address are refused too.
        const newPassword =
          params.flow === "signUp" ? params.password : params.flow === "reset-verification" ? params.newPassword : undefined;
        if (typeof newPassword === "string") validatePassword(newPassword, email);
        const profile: Record<string, Value> & { email: string } = { email };
        if (params.flow === "signUp") {
          const name = String(params.name ?? "").trim();
          if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
            throw new ConvexError(`Name must be 1 to ${MAX_NAME_LENGTH} characters.`);
          }
          profile.name = name;
          profile.updatedAt = Date.now();
        }
        return profile;
      },
      validatePasswordRequirements: (password) => validatePassword(password),
      reset: PasswordReset,
    }),
  ],
});
