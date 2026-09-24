"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { LoaderCircle } from "lucide-react";
import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { createKeySchema } from "./create-key-dialog";

const renameSchema = z.object({ name: createKeySchema.shape.name });
type RenameValues = z.infer<typeof renameSchema>;

export function RenameKeyDialog({
  open,
  currentName,
  onOpenChange,
  onRename,
}: {
  open: boolean;
  currentName: string;
  onOpenChange: (open: boolean) => void;
  onRename: (name: string) => Promise<void>;
}) {
  const form = useForm<RenameValues>({ resolver: zodResolver(renameSchema), defaultValues: { name: currentName } });
  const { errors, isSubmitting } = form.formState;

  useEffect(() => {
    if (open) form.reset({ name: currentName });
  }, [open, currentName, form]);

  return (
    <Dialog open={open} onOpenChange={(next) => !isSubmitting && onOpenChange(next)}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={form.handleSubmit(({ name }) => onRename(name))} noValidate className="grid gap-4">
          <DialogHeader>
            <DialogTitle>Rename API key</DialogTitle>
          </DialogHeader>
          <Field data-invalid={!!errors.name}>
            <FieldLabel htmlFor="rename-key-name">Name</FieldLabel>
            <Input
              id="rename-key-name"
              autoComplete="off"
              aria-invalid={!!errors.name}
              aria-describedby={errors.name ? "rename-key-name-error" : undefined}
              {...form.register("name")}
            />
            <FieldError id="rename-key-name-error" errors={[errors.name]} />
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
