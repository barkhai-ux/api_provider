"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { api } from "@geo-platform/convex/api";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient } from "@tanstack/react-query";
import { useAction, useMutation } from "convex/react";
import { LoaderCircle, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { MIN_PASSWORD_LENGTH, nameSchema, newPasswordSchema } from "@/components/auth/schemas";
import { PasswordInput } from "@/components/auth/password-input";
import { FormAlert } from "@/components/auth/form-alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsoleQuery } from "@/hooks/use-console-query";
import { actionErrorMessage } from "@/lib/auth-errors";
import { formatDate } from "@/lib/format";
import { PageHeader } from "./page-header";
import { useT } from "@/lib/i18n/provider";

const profileSchema = z.object({ name: nameSchema });
type ProfileValues = z.infer<typeof profileSchema>;

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, "Enter your current password."),
    newPassword: newPasswordSchema,
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    message: "The passwords do not match.",
    path: ["confirmPassword"],
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    message: "Choose a new password that differs from the current one.",
    path: ["newPassword"],
  });
type PasswordValues = z.infer<typeof passwordSchema>;

function ProfileCard() {
  const viewer = useConsoleQuery(api.users.viewer, {});
  const updateProfile = useMutation(api.users.updateProfile);
  const queryClient = useQueryClient();
  const form = useForm<ProfileValues>({ resolver: zodResolver(profileSchema), defaultValues: { name: "" } });
  const { errors, isSubmitting, isDirty } = form.formState;

  useEffect(() => {
    if (viewer) form.reset({ name: viewer.name });
  }, [viewer, form]);

  async function onSubmit(values: ProfileValues) {
    try {
      await updateProfile({ name: values.name });
      form.reset(values);
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      toast.success("Profile saved.");
    } catch (error) {
      toast.error(actionErrorMessage(error, "Could not save your profile."));
    }
  }

  return (
    <Card>
      <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader>
          <CardTitle>
            <h2>Profile</h2>
          </CardTitle>
          <CardDescription>
            {viewer ? `Member since ${formatDate(viewer.createdAt)}.` : <Skeleton className="h-4 w-40" />}
          </CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="profile-name">Name</FieldLabel>
              <Input
                id="profile-name"
                autoComplete="name"
                disabled={!viewer}
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "profile-name-error" : undefined}
                {...form.register("name")}
              />
              <FieldError id="profile-name-error" errors={[errors.name]} />
            </Field>
            <Field>
              <FieldLabel htmlFor="profile-email">Email</FieldLabel>
              <Input id="profile-email" type="email" value={viewer?.email ?? ""} readOnly disabled aria-describedby="profile-email-help" />
              <FieldDescription id="profile-email-help">Changing your email is not supported yet.</FieldDescription>
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-4 justify-end">
          <Button type="submit" disabled={!viewer || !isDirty || isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Save profile
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function PasswordCard() {
  const changePassword = useAction(api.users.changePassword);
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<PasswordValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { currentPassword: "", newPassword: "", confirmPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;

  async function onSubmit(values: PasswordValues) {
    setFormError(null);
    try {
      await changePassword({ currentPassword: values.currentPassword, newPassword: values.newPassword });
      form.reset();
      toast.success("Password changed. Your other sessions were signed out.");
    } catch (error) {
      setFormError(actionErrorMessage(error, "Could not change your password."));
    }
  }

  return (
    <Card>
      <form method="post" onSubmit={form.handleSubmit(onSubmit)} noValidate>
        <CardHeader>
          <CardTitle>
            <h2>Password</h2>
          </CardTitle>
          <CardDescription>Changing your password signs you out everywhere except this browser.</CardDescription>
        </CardHeader>
        <CardContent className="pt-4">
          <FieldGroup>
            <FormAlert message={formError} />
            <Field data-invalid={!!errors.currentPassword}>
              <FieldLabel htmlFor="current-password">Current password</FieldLabel>
              <PasswordInput
                id="current-password"
                autoComplete="current-password"
                aria-invalid={!!errors.currentPassword}
                aria-describedby={errors.currentPassword ? "current-password-error" : undefined}
                {...form.register("currentPassword")}
              />
              <FieldError id="current-password-error" errors={[errors.currentPassword]} />
            </Field>
            <Field data-invalid={!!errors.newPassword}>
              <FieldLabel htmlFor="new-password">New password</FieldLabel>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                aria-invalid={!!errors.newPassword}
                aria-describedby="new-password-help new-password-error"
                {...form.register("newPassword")}
              />
              <FieldDescription id="new-password-help">At least {MIN_PASSWORD_LENGTH} characters.</FieldDescription>
              <FieldError id="new-password-error" errors={[errors.newPassword]} />
            </Field>
            <Field data-invalid={!!errors.confirmPassword}>
              <FieldLabel htmlFor="confirm-password">Confirm new password</FieldLabel>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                aria-invalid={!!errors.confirmPassword}
                aria-describedby={errors.confirmPassword ? "confirm-password-error" : undefined}
                {...form.register("confirmPassword")}
              />
              <FieldError id="confirm-password-error" errors={[errors.confirmPassword]} />
            </Field>
          </FieldGroup>
        </CardContent>
        <CardFooter className="mt-4 justify-end">
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            Change password
          </Button>
        </CardFooter>
      </form>
    </Card>
  );
}

function SessionCard() {
  const { signOut } = useAuthActions();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function handleSignOut() {
    setPending(true);
    try {
      await signOut();
      await queryClient.invalidateQueries({ queryKey: ["session"] });
      router.push("/");
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>
          <h2>Session</h2>
        </CardTitle>
        <CardDescription>Sign out of the developer console on this browser.</CardDescription>
      </CardHeader>
      <CardFooter className="justify-end">
        <Button variant="outline" onClick={handleSignOut} disabled={pending}>
          {pending ? <LoaderCircle className="animate-spin" aria-hidden="true" /> : <LogOut aria-hidden="true" />}
          Sign out
        </Button>
      </CardFooter>
    </Card>
  );
}

export function SettingsView() {
  const t = useT();
  return (
    <>
      <PageHeader title={t("dashboard.settings.title")} description={t("dashboard.settings.subtitle")} />
      <div className="grid max-w-2xl gap-6">
        <ProfileCard />
        <PasswordCard />
        <SessionCard />
      </div>
    </>
  );
}
