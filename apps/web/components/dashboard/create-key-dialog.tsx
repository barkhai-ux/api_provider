"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldContent, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";

const MAX_KEY_NAME_LENGTH = 100;

export const createKeySchema = z.object({
  name: z.string().trim().min(1, "Give the key a name.").max(MAX_KEY_NAME_LENGTH, `Use at most ${MAX_KEY_NAME_LENGTH} characters.`),
  environment: z.enum(["live", "test"]),
});
export type CreateKeyValues = z.infer<typeof createKeySchema>;

export function CreateKeyDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: CreateKeyValues) => Promise<void>;
}) {
  const form = useForm<CreateKeyValues>({
    resolver: zodResolver(createKeySchema),
    defaultValues: { name: "", environment: "live" },
  });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset({ name: "", environment: "live" });
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(onCreate)} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Use a separate key for each app or environment, so you can revoke one without affecting the others.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!errors.name}>
              <FieldLabel htmlFor="create-key-name">Name</FieldLabel>
              <Input
                id="create-key-name"
                placeholder="Production web app"
                autoComplete="off"
                aria-invalid={!!errors.name}
                aria-describedby={errors.name ? "create-key-name-error" : undefined}
                {...form.register("name")}
              />
              <FieldError id="create-key-name-error" errors={[errors.name]} />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Environment</FieldLegend>
              <Controller
                control={form.control}
                name="environment"
                render={({ field }) => (
                  <RadioGroup value={field.value} onValueChange={field.onChange} className="grid gap-2">
                    <FieldLabel htmlFor="env-live">
                      <Field orientation="horizontal">
                        <RadioGroupItem value="live" id="env-live" />
                        <FieldContent>
                          <span className="font-medium">Live</span>
                          <FieldDescription>Prefix geo_live_. For production traffic.</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                    <FieldLabel htmlFor="env-test">
                      <Field orientation="horizontal">
                        <RadioGroupItem value="test" id="env-test" />
                        <FieldContent>
                          <span className="font-medium">Test</span>
                          <FieldDescription>Prefix geo_test_. For development and CI.</FieldDescription>
                        </FieldContent>
                      </Field>
                    </FieldLabel>
                  </RadioGroup>
                )}
              />
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
