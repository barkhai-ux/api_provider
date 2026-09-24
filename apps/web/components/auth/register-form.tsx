"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { authErrorMessage } from "@/lib/auth-errors";
import { AuthCard } from "./auth-card";
import { FormAlert } from "./form-alert";
import { PasswordInput } from "./password-input";
import { MIN_PASSWORD_LENGTH, registerSchema, type RegisterValues } from "./schemas";
import { useAfterSignIn } from "./use-after-sign-in";

export function RegisterForm() {
  const { signIn } = useAuthActions();
  const afterSignIn = useAfterSignIn();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<RegisterValues>({
    resolver: zodResolver(registerSchema),
    defaultValues: { name: "", email: "", password: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: RegisterValues) {
    setFormError(null);
    try {
      await signIn("password", { ...values, flow: "signUp" });
      await afterSignIn();
    } catch (error) {
      setFormError(authErrorMessage(error));
    }
  }

  return (
    <AuthCard
      title="Create your developer account"
      description="Get an API key for geocoding, reverse geocoding and routing."
      footer={
        <span>
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Sign in
          </Link>
        </span>
      }
    >
      <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="register-name">Name</FieldLabel>
            <Input
              id="register-name"
              autoComplete="name"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "register-name-error" : undefined}
              {...form.register("name")}
            />
            <FieldError id="register-name-error" errors={[errors.name]} />
          </Field>
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="register-email">Email</FieldLabel>
            <Input
              id="register-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "register-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="register-email-error" errors={[errors.email]} />
          </Field>
          <Field data-invalid={!!errors.password}>
            <FieldLabel htmlFor="register-password">Password</FieldLabel>
            <PasswordInput
              id="register-password"
              autoComplete="new-password"
              aria-invalid={!!errors.password}
              aria-describedby="register-password-help register-password-error"
              {...form.register("password")}
            />
            <FieldDescription id="register-password-help">At least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
            <FieldError id="register-password-error" errors={[errors.password]} />
          </Field>
          <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Create account
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
