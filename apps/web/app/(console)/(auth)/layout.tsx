import { AuthShowcase } from "@/components/auth/auth-showcase";
import { SiteHeader } from "@/components/site/site-header";

/** Split layout: the form on the left, a product panel on the right (desktop). */
export default function AuthLayout({ children }: LayoutProps<"/">) {
  return (
    <>
      <SiteHeader />
      <main id="main" className="grid flex-1 lg:grid-cols-2">
      <div className="flex items-start justify-center px-4 py-12 sm:items-center sm:py-16">{children}</div>
      <aside className="theme-dark relative hidden overflow-hidden border-l bg-background text-foreground lg:flex lg:items-center lg:justify-center lg:px-14 xl:px-20">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 bg-[radial-gradient(45%_35%_at_70%_55%,oklch(0.55_0.2_262/0.22),transparent_70%)]"
        />
        <AuthShowcase />
      </aside>
      </main>
    </>
  );
}
