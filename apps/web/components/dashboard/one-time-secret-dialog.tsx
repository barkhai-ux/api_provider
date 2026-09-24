"use client";

import { Check, Copy, Download, TriangleAlert } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { RevealedSecret } from "./api-key-types";

function fileName(keyName: string): string {
  const slug = keyName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `geo-platform-api-key${slug ? `-${slug}` : ""}.txt`;
}

export function secretFileContents(revealed: RevealedSecret, now: Date = new Date()): string {
  return [
    "Geo Platform API key",
    "",
    `Name:    ${revealed.name}`,
    `Key:     ${revealed.secret}`,
    `Created: ${now.toISOString()}`,
    "",
    "Keep this key secret. It will not be shown again in the dashboard.",
    "Send it with every request:  Authorization: Bearer <key>",
    "Never put it in browser or mobile app code; call the API from your server.",
    "",
  ].join("\n");
}

/**
 * Shows a newly created (or regenerated) secret exactly once. It cannot be
 * dismissed by clicking outside or pressing Escape; only "Done" closes it, and
 * the parent then drops the secret from memory.
 */
export function OneTimeSecretDialog({
  revealed,
  onDone,
}: {
  revealed: RevealedSecret | null;
  onDone: () => void;
}) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    if (!revealed) return;
    try {
      await navigator.clipboard.writeText(revealed.secret);
      setCopied(true);
      toast.success("API key copied to the clipboard.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy. Select the key and copy it manually.");
    }
  }

  function download() {
    if (!revealed) return;
    const url = URL.createObjectURL(new Blob([secretFileContents(revealed)], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(revealed.name);
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function done() {
    setCopied(false);
    onDone();
  }

  return (
    <AlertDialog open={revealed !== null}>
      <AlertDialogContent className="sm:max-w-lg data-[size=default]:max-w-[calc(100%-2rem)] data-[size=default]:sm:max-w-lg" onEscapeKeyDown={(event) => event.preventDefault()}>
        <AlertDialogHeader>
          <AlertDialogTitle>{revealed?.regenerated ? "Your new API key secret" : "Save your API key"}</AlertDialogTitle>
          <AlertDialogDescription>
            {revealed?.regenerated
              ? `The previous secret for “${revealed.name}” no longer works. Update your applications with this one.`
              : `Your key “${revealed?.name ?? ""}” is ready. Copy it now and store it somewhere safe, like a secrets manager.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <Alert>
          <TriangleAlert className="text-warning" />
          <AlertTitle>This secret will not be shown again</AlertTitle>
          <AlertDescription>
            We only store a hash of it. If you lose it, regenerate the key or create a new one.
          </AlertDescription>
        </Alert>
        <div className="grid gap-2">
          <Label htmlFor="one-time-secret">API key</Label>
          <div className="flex gap-2">
            <Input
              id="one-time-secret"
              readOnly
              value={revealed?.secret ?? ""}
              onFocus={(event) => event.currentTarget.select()}
              className="min-w-0 font-mono text-xs"
              spellCheck={false}
              autoComplete="off"
            />
            <Button type="button" variant="outline" onClick={copy} aria-label="Copy API key">
              {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
              <span className="hidden sm:inline">{copied ? "Copied" : "Copy"}</span>
            </Button>
          </div>
        </div>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={download}>
            <Download aria-hidden="true" /> Download
          </Button>
          <AlertDialogAction onClick={done}>Done</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
