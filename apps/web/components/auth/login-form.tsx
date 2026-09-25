"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useT } from "@/lib/i18n/provider";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { localizedAuthError } from "@/lib/auth-errors";
import { AuthCard } from "./auth-card";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";
import { loginSchema, type LoginValues } from "./schemas";
import { useAfterSignIn } from "./use-after-sign-in";

export function LoginForm() {
  const { signIn } = useAuthActions();
  const afterSignIn = useAfterSignIn();
  const [formError, setFormError] = useState<string | null>(null);
  const t = useT();
  const form = useForm<LoginValues>({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: LoginValues) {
    setFormError(null);
    try {
      await signIn("password", { email: values.email, password: values.password, flow: "signIn" });
      await afterSignIn();
    } catch (error) {
      setFormError(localizedAuthError(error, t));
    }
  }

  return (
    <AuthCard
      title={t("auth.login.title")}
      description={t("auth.login.description")}
      footer={
        <span>
          New here?{" "}
          <Link href="/register" className="font-medium text-primary underline-offset-4 hover:underline">
            Create an account
          </Link>
        </span>
      }
    >
      <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="login-email">{t("auth.login.email")}</FieldLabel>
            <Input
              id="login-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "login-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="login-email-error" errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <div className="flex items-center justify-between">
              <FieldLabel htmlFor="login-password">{t("auth.login.password")}</FieldLabel>
              <Link
                href="/forgot-password"
                className="text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
              >
                {t("auth.login.forgot")}
              </Link>
            </div>
            <PasswordInput
              id="login-password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? "login-password-error" : undefined}
              {...form.register("password")}
            />
            <FieldError id="login-password-error" errors={[errors.password]} />
          </Field>
          <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {t("auth.login.submit")}
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
