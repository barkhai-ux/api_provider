"use client";

import { api } from "@geo-platform/convex/api";
import type { Id } from "@geo-platform/convex/dataModel";
import { useAction, useMutation } from "convex/react";
import { KeyRound, Plus, ShieldCheck } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useConsoleQuery } from "@/hooks/use-console-query";
import { actionErrorMessage } from "@/lib/auth-errors";
import { ApiKeysTable, type KeyAction } from "./api-keys-table";
import type { ApiKey, RevealedSecret } from "./api-key-types";
import { ConfirmDialog } from "./confirm-dialog";
import { CreateKeyDialog, type CreateKeyValues } from "./create-key-dialog";
import { EmptyState } from "./empty-state";
import { OneTimeSecretDialog } from "./one-time-secret-dialog";
import { PageHeader } from "./page-header";
import { useT } from "@/lib/i18n/provider";
import { RenameKeyDialog } from "./rename-key-dialog";

export function ApiKeysView() {
  const t = useT();
  const keys = useConsoleQuery(api.apiKeys.list, {});
  const createKey = useAction(api.apiKeys.create);
  const regenerateKey = useAction(api.apiKeys.regenerate);
  const renameKey = useMutation(api.apiKeys.rename);
  const revokeKey = useMutation(api.apiKeys.revoke);
  const router = useRouter();
  const searchParams = useSearchParams();

  // /dashboard/api-keys?create=1 (from the overview's empty state) opens the create dialog.
  const [createOpen, setCreateOpen] = useState(() => searchParams.get("create") === "1");
  const [revealed, setRevealed] = useState<RevealedSecret | null>(null);
  const [pending, setPending] = useState<{ action: KeyAction; key: ApiKey } | null>(null);

  useEffect(() => {
    if (searchParams.get("create") === "1") router.replace("/dashboard/api-keys", { scroll: false });
  }, [searchParams, router]);

  async function handleCreate(values: CreateKeyValues) {
    try {
      const result = await createKey(values);
      setCreateOpen(false);
      setRevealed({ name: values.name, secret: result.secret, regenerated: false });
    } catch (error) {
      toast.error(actionErrorMessage(error, "Could not create the key."));
    }
  }

  async function handleRename(name: string) {
    if (!pending) return;
    try {
      await renameKey({ keyId: pending.key.id as Id<"apiKeys">, name });
      toast.success("Key renamed.");
      setPending(null);
    } catch (error) {
      toast.error(actionErrorMessage(error, "Could not rename the key."));
    }
  }

  async function handleRevoke() {
    if (!pending) return;
    try {
      await revokeKey({ keyId: pending.key.id as Id<"apiKeys"> });
      toast.success(`“${pending.key.name}” was revoked.`);
    } catch (error) {
      toast.error(actionErrorMessage(error, "Could not revoke the key."));
      throw error;
    }
  }

  async function handleRegenerate() {
    if (!pending) return;
    try {
      const result = await regenerateKey({ keyId: pending.key.id as Id<"apiKeys"> });
      setRevealed({ name: pending.key.name, secret: result.secret, regenerated: true });
    } catch (error) {
      toast.error(actionErrorMessage(error, "Could not regenerate the key."));
      throw error;
    }
  }

  const active = keys?.filter((key) => key.revokedAt === null) ?? [];
  const revoked = keys?.filter((key) => key.revokedAt !== null) ?? [];
  const onAction = (action: KeyAction, key: ApiKey) => setPending({ action, key });

  return (
    <>
      <PageHeader
        title={t("dashboard.apiKeys.title")}
        description={t("dashboard.apiKeys.subtitle")}
        actions={
          <Button size="pill" className="h-10 px-5" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden="true" /> {t("dashboard.apiKeys.create")}
          </Button>
        }
      />

      {keys === undefined ? (
        <div className="space-y-3" aria-busy="true" aria-label="Loading API keys">
          <Skeleton className="h-16 w-full rounded-2xl" />
          <Skeleton className="h-16 w-full rounded-2xl" />
        </div>
      ) : active.length === 0 ? (
        <EmptyState
          icon={KeyRound}
          title="No active API keys"
          description="Create a key to start calling the geocoding, reverse geocoding and routing APIs."
          action={
            <Button onClick={() => setCreateOpen(true)}>
              <Plus aria-hidden="true" /> {t("dashboard.apiKeys.create")}
            </Button>
          }
        />
      ) : (
        <section aria-label="Active API keys">
          <ApiKeysTable keys={active} onAction={onAction} caption="Active API keys" />
        </section>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-px size-4 shrink-0" aria-hidden="true" />
        Keys are stored only as hashes and shown in full just once, when created or regenerated. Keep them on your
        server; never ship them in browser or mobile app code.
      </p>

      {revoked.length > 0 && (
        <details className="group mt-8">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground hover:text-foreground">
            Revoked keys ({revoked.length})
          </summary>
          <div className="mt-3">
            <ApiKeysTable keys={revoked} onAction={onAction} caption="Revoked API keys" />
          </div>
        </details>
      )}

      <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} onCreate={handleCreate} />
      <OneTimeSecretDialog revealed={revealed} onDone={() => setRevealed(null)} />
      <RenameKeyDialog
        open={pending?.action === "rename"}
        currentName={pending?.key.name ?? ""}
        onOpenChange={(open) => !open && setPending(null)}
        onRename={handleRename}
      />
      <ConfirmDialog
        open={pending?.action === "revoke"}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Revoke “${pending?.key.name ?? ""}”?`}
        description="Requests using this key will be rejected with 403 API_KEY_REVOKED immediately. This cannot be undone."
        confirmLabel="Revoke key"
        destructive
        onConfirm={handleRevoke}
      />
      <ConfirmDialog
        open={pending?.action === "regenerate"}
        onOpenChange={(open) => !open && setPending(null)}
        title={`Regenerate “${pending?.key.name ?? ""}”?`}
        description="You will get a new secret for this key. The current secret stops working immediately, so update your applications right away. Name and usage history are kept."
        confirmLabel="Regenerate secret"
        onConfirm={handleRegenerate}
      />
    </>
  );
}
