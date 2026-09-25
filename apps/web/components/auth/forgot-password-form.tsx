"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useT } from "@/lib/i18n/provider";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { isNetworkError, NETWORK_ERROR } from "@/lib/auth-errors";
import { AuthCard } from "./auth-card";
import { FormAlert } from "./form-alert";
import { forgotPasswordSchema, type ForgotPasswordValues } from "./schemas";

export function ForgotPasswordForm() {
  const { signIn } = useAuthActions();
  const router = useRouter();
  const [formError, setFormError] = useState<string | null>(null);
  const t = useT();
  const form = useForm<ForgotPasswordValues>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: { email: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit({ email }: ForgotPasswordValues) {
    setFormError(null);
    try {
      await signIn("password", { email, flow: "reset" });
    } catch (error) {
      // Unknown emails fail too; the page must not reveal which emails have
      // accounts, so only connection problems are reported.
      if (error instanceof Error && isNetworkError(error.message)) {
        setFormError(NETWORK_ERROR);
        return;
      }
    }
    router.push(`/reset-password?email=${encodeURIComponent(email)}&sent=1`);
  }

  return (
    <AuthCard
      title={t("auth.forgot.title")}
      description={t("auth.forgot.description")}
      footer={
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          {t("auth.forgot.back")}
        </Link>
      }
    >
      <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <FieldGroup>
          <FormAlert message={formError} />
          <Field data-invalid={!!errors.email}>
            <FieldLabel htmlFor="forgot-email">{t("auth.forgot.email")}</FieldLabel>
            <Input
              id="forgot-email"
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "forgot-email-error" : undefined}
              {...form.register("email")}
            />
            <FieldError id="forgot-email-error" errors={[errors.email]} />
          </Field>
          <Button type="submit" size="xl" className="w-full" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {t("auth.forgot.submit")}
          </Button>
        </FieldGroup>
      </form>
    </AuthCard>
  );
}
