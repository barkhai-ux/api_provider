import { Email } from "@convex-dev/auth/providers/Email";
import { isProduction } from "./env";
import { randomString } from "./crypto";

const CODE_LENGTH = 8;
const CODE_TTL_SECONDS = 15 * 60;

/**
 * Password reset by emailed one-time code.
 *
 * EMAIL_BACKEND=resend sends through the Resend HTTP API (RESEND_API_KEY,
 * EMAIL_FROM). EMAIL_BACKEND=console (development only) writes the code to the
 * Convex function logs instead.
 */
export const PasswordReset = Email({
  id: "password-reset",
  maxAge: CODE_TTL_SECONDS,
  // The code is tied to the account's normalized (lowercase) email. Compare
  // normalized values so "Dev@Example.com" and "dev@example.com" match.
  async authorize(params, account) {
    const email = typeof params.email === "string" ? params.email.trim().toLowerCase() : "";
    if (email === "" || email !== String(account.providerAccountId ?? "").trim().toLowerCase()) {
      throw new Error("The reset code does not match this email address.");
    }
  },
  async generateVerificationToken() {
    return randomString(CODE_LENGTH, "0123456789");
  },
  async sendVerificationRequest({ identifier: email, token }) {
    const backend = process.env.EMAIL_BACKEND ?? "console";
    const subject = "Your Ubhub Location Service password reset code";
    const text =
      `Your password reset code is ${token}.\n\n` +
      `It expires in ${CODE_TTL_SECONDS / 60} minutes. If you did not ask to reset your password, ignore this email.`;
    if (backend === "resend") {
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: process.env.EMAIL_FROM ?? "Ubhub Location Service <no-reply@example.com>",
          to: [email],
          subject,
          text,
        }),
      });
      if (!response.ok) {
        throw new Error(`Could not send the password reset email (HTTP ${response.status}).`);
      }
      return;
    }
    if (isProduction()) {
      throw new Error("EMAIL_BACKEND=console is not allowed in production.");
    }
    // DEVELOPMENT ONLY: visible in the Convex dashboard logs / `npx convex logs`.
    console.log(`[DEV EMAIL] To: ${email} | ${subject} | code: ${token}`);
  },
});
