"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatDate } from "@/lib/format";
import {
  DEFAULT_EXPIRY,
  EXPIRY_CHOICES,
  EXPIRY_CHOICE_VALUES,
  KEY_ENDPOINTS,
  KEY_ENDPOINT_IDS,
  type KeyEndpoint,
  customDateBounds,
  endOfDay,
  expiresAtFor,
} from "./key-options";

const MAX_KEY_NAME_LENGTH = 100;

export const createKeySchema = z
  .object({
    name: z.string().trim().min(1, "Give the key a name.").max(MAX_KEY_NAME_LENGTH, `Use at most ${MAX_KEY_NAME_LENGTH} characters.`),
    endpoints: z.array(z.enum(KEY_ENDPOINT_IDS)).min(1, "Choose at least one endpoint."),
    expiry: z.enum(EXPIRY_CHOICE_VALUES),
    customDate: z.string(),
  })
  .superRefine((values, ctx) => {
    if (values.expiry !== "custom") return;
    const { min, max } = customDateBounds(Date.now());
    if (endOfDay(values.customDate) === null) {
      ctx.addIssue({ code: "custom", path: ["customDate"], message: "Pick the date the key stops working." });
    } else if (values.customDate < min) {
      ctx.addIssue({ code: "custom", path: ["customDate"], message: "Pick a date after today." });
    } else if (values.customDate > max) {
      ctx.addIssue({ code: "custom", path: ["customDate"], message: "Pick a date within 5 years." });
    }
  });
type CreateKeyForm = z.infer<typeof createKeySchema>;

/** What the dashboard sends to Convex. expiresAt is Unix ms, or null for a key that never expires. */
export type CreateKeyValues = { name: string; endpoints: KeyEndpoint[]; expiresAt: number | null };

const DEFAULTS: CreateKeyForm = { name: "", endpoints: [...KEY_ENDPOINT_IDS], expiry: DEFAULT_EXPIRY, customDate: "" };

/** Turns the form into the values sent to Convex, taking the expiry from the time of submitting. */
function toCreateValues(values: CreateKeyForm): CreateKeyValues {
  return {
    name: values.name,
    endpoints: values.endpoints,
    expiresAt: expiresAtFor(values.expiry, values.customDate, Date.now()),
  };
}

function ExpirySummary({ expiry, customDate }: { expiry: CreateKeyForm["expiry"]; customDate: string }) {
  // The summary uses the time the dialog renders; the exact time is taken again on submit.
  const [now] = useState(() => Date.now());
  const expiresAt = expiresAtFor(expiry, customDate, now);
  if (expiry === "never") return <>The key never expires. You can revoke it at any time.</>;
  if (expiresAt === null) return <>The key stops working at the end of the chosen day.</>;
  return <>The key stops working on {formatDate(expiresAt)}.</>;
}

export function CreateKeyDialog({
  open,
  onOpenChange,
  onCreate,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (values: CreateKeyValues) => Promise<void>;
}) {
  const form = useForm<CreateKeyForm>({ resolver: zodResolver(createKeySchema), defaultValues: DEFAULTS });
  const { errors, isSubmitting } = form.formState;
  const expiry = useWatch({ control: form.control, name: "expiry" });
  const customDate = useWatch({ control: form.control, name: "customDate" });
  const [bounds] = useState(() => customDateBounds(Date.now()));

  useEffect(() => {
    if (open) form.reset(DEFAULTS);
  }, [open, form]);

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="max-h-[92dvh] overflow-y-auto sm:max-w-md">
        <form onSubmit={form.handleSubmit((values) => onCreate(toCreateValues(values)))} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>Use a separate key for each app, so you can revoke one without affecting the others.</DialogDescription>
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

            <FieldSet data-invalid={!!errors.endpoints}>
              <FieldLegend variant="label">Endpoints</FieldLegend>
              <FieldDescription>The key can call only the endpoints you choose.</FieldDescription>
              <Controller
                control={form.control}
                name="endpoints"
                render={({ field }) => (
                  <div className="grid gap-2" role="group" aria-label="Endpoints">
                    {KEY_ENDPOINTS.map((endpoint) => {
                      const id = `create-key-endpoint-${endpoint.id}`;
                      const checked = field.value.includes(endpoint.id);
                      return (
                        <FieldLabel key={endpoint.id} htmlFor={id}>
                          <Field orientation="horizontal">
                            <Checkbox
                              id={id}
                              checked={checked}
                              onCheckedChange={(next) =>
                                field.onChange(
                                  next === true
                                    ? KEY_ENDPOINT_IDS.filter((e) => e === endpoint.id || field.value.includes(e))
                                    : field.value.filter((e) => e !== endpoint.id),
                                )
                              }
                              aria-invalid={!!errors.endpoints}
                            />
                            <FieldContent>
                              <span className="font-medium">{endpoint.label}</span>
                              <FieldDescription className="font-mono text-xs">GET {endpoint.path}</FieldDescription>
                            </FieldContent>
                          </Field>
                        </FieldLabel>
                      );
                    })}
                  </div>
                )}
              />
              <FieldError errors={[errors.endpoints]} />
            </FieldSet>

            <Field data-invalid={!!errors.customDate}>
              <FieldLabel htmlFor="create-key-expiry">Expiration</FieldLabel>
              <Controller
                control={form.control}
                name="expiry"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={field.onChange}>
                    <SelectTrigger id="create-key-expiry" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {EXPIRY_CHOICES.map((choice) => (
                        <SelectItem key={choice.value} value={choice.value}>
                          {choice.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
              {expiry === "custom" && (
                <Input
                  type="date"
                  aria-label="Expiry date"
                  min={bounds.min}
                  max={bounds.max}
                  aria-invalid={!!errors.customDate}
                  {...form.register("customDate")}
                />
              )}
              <FieldDescription>
                <ExpirySummary expiry={expiry} customDate={customDate} />
              </FieldDescription>
              <FieldError errors={[errors.customDate]} />
            </Field>
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
