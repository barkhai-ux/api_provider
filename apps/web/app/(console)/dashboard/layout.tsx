import { isAuthenticatedNextjs } from "@convex-dev/auth/nextjs/server";
import { redirect } from "next/navigation";
import { DashboardShell } from "@/components/dashboard/dashboard-shell";
import { serverEnv } from "@/lib/server-env";

export default async function DashboardLayout({ children }: LayoutProps<"/dashboard">) {
  // The proxy already redirects signed-out visitors; this is the real check.
  if (!(await isAuthenticatedNextjs({ convexUrl: serverEnv().convexUrl }))) {
    redirect("/login?next=/dashboard");
  }
  return <DashboardShell>{children}</DashboardShell>;
}
