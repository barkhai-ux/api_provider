"use client";

import { useQueryClient } from "@tanstack/react-query";
import { LayoutDashboard, LogOut, Settings } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/hooks/use-session";
import { signOutViaProxy } from "@/lib/auth-client";
import { useT } from "@/lib/i18n/provider";

function initials(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

/** Right side of the header: sign-in buttons, or the account menu. */
export function AuthNav({ compact = false }: { compact?: boolean }) {
  const { data, isPending } = useSession();
  const router = useRouter();
  const queryClient = useQueryClient();
  const t = useT();

  if (isPending) return <Skeleton className="h-9 w-44 rounded-full" aria-label="Loading account" />;

  if (!data?.authenticated) {
    return (
      <div className="flex items-center gap-1">
        <Button asChild variant="ghost" size={compact ? "sm" : "default"} className="font-semibold">
          <Link href="/login">{t("authNav.signIn")}</Link>
        </Button>
        <Button asChild size="pill">
          <Link href="/register">{t("authNav.getApiKey")}</Link>
        </Button>
      </div>
    );
  }

  const { name, email } = data.user;
  async function signOut() {
    await signOutViaProxy();
    await queryClient.invalidateQueries({ queryKey: ["session"] });
    router.push("/");
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("authNav.accountMenu")} className="rounded-full">
          <Avatar className="size-8">
            <AvatarFallback className="bg-primary/10 text-xs font-medium text-primary">
              {initials(name, email)}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="font-normal">
          <div className="truncate text-sm font-medium">{name || t("authNav.developer")}</div>
          <div className="truncate text-xs text-muted-foreground">{email}</div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/dashboard">
            <LayoutDashboard /> {t("authNav.dashboard")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/settings">
            <Settings /> {t("authNav.account")}
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={signOut}>
          <LogOut /> {t("authNav.signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
