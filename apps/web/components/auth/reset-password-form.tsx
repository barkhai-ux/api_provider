"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { LoaderCircle, Mail } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authErrorMessage } from "@/lib/auth-errors";
import { AuthCard } from "./auth-card";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";
import { MIN_PASSWORD_LENGTH, resetPasswordSchema, type ResetPasswordValues } from "./schemas";

export function ResetPasswordForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const queryClient = useQueryClient();
  const searchParams = useSearchParams();
  const sent = searchParams.get("sent") === "1";
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<ResetPasswordValues>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: { email: searchParams.get("email") ?? "", code: "", newPassword: "", confirmPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: ResetPasswordValues) {
    setFormError(null);
    try {
      await signIn("password", {
        email: values.email,
        code: values.code,
        newPassword: values.newPassword,
        flow: "reset-verification",
      });
      toast.success("Password updated. Other sessions were signed out.");
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.replace("/dashboard");
      router.refresh();
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  return (
    <AuthCard
      title="Choose a new password"
      description="Enter the code from the email and your new password."
      footer={
        <span>
          No code?{" "}
          <Link href="/forgot-password" className="font-medium text-primary underline-offset-4 hover:underline">
            Send a new one
          </Link>
        </span>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          {sent && (
            <Alert>
              <Mail />
              <AlertDescription>
                If an account exists for that email, we sent a code. It expires in 15 minutes.
              </AlertDescription>
            </Alert>
          )}
          <FormAlert message={formError} />
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="reset-email">Email</FieldLabel>
            <Input
              id="reset-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "reset-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="reset-email-error" errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.code}>
            <FieldLabel htmlFor="reset-code">Code</FieldLabel>
            <Input
              id="reset-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              placeholder="12345678"
              className="font-mono tracking-widest"
              aria-invalid={!!errors.code}
              aria-describedby={errors.code ? "reset-code-error" : undefined}
              {...form.register("code")}
            />
            <FieldError id="reset-code-error" errors={[errors.code]} />
          </Field>
          <Field data-invalid={!!errors.newPassword}>
            <FieldLabel htmlFor="reset-password">New password</FieldLabel>
            <PasswordInput
              id="reset-password"
              autoComplete="new-password"
              aria-invalid={!!errors.newPassword}
              aria-describedby="reset-password-help reset-password-error"
              {...form.register("newPassword")}
            />
            <FieldDescription id="reset-password-help">At least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
            <FieldError id="reset-password-error" errors={[errors.newPassword]} />
          </Field>
          <Field data-invalid={!!errors.confirmPassword}>
            <FieldLabel htmlFor="reset-confirm">Confirm new password</FieldLabel>
            <PasswordInput
              id="reset-confirm"
              autoComplete="new-password"
              aria-invalid={!!errors.confirmPassword}
              aria-describedby={errors.confirmPassword ? "reset-confirm-error" : undefined}
              {...form.register("confirmPassword")}
            />
            <FieldError id="reset-confirm-error" errors={[errors.confirmPassword]} />
          </Field>
          <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Set new password
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
