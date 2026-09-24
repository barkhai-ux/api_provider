import { Password } from "@convex-dev/auth/providers/Password";
import { convexAuth } from "@convex-dev/auth/server";
import { ConvexError, type Value } from "convex/values";
import { PasswordReset } from "./lib/passwordReset";

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;
const MAX_NAME_LENGTH = 120;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validatePassword(password: string): void {
  if (
    typeof password !== "string" ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    throw new ConvexError(
      `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters.`,
    );
  }
}

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  providers: [
    Password({
      profile(params) {
        const email = String(params.email ?? "").trim().toLowerCase();
        if (!EMAIL_PATTERN.test(email) || email.length > 320) {
          throw new ConvexError("Enter a valid email address.");
        }
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
      validatePasswordRequirements: validatePassword,
      reset: PasswordReset,
    }),
  ],
});
