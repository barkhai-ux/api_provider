import { DocsMobileNav, DocsNavList } from "@/components/docs/docs-nav";

export default function DocsLayout({ children }: LayoutProps<"/developers/docs">) {
  return (
    <div className="mx-auto flex w-full max-w-7xl gap-10 px-4 sm:px-6">
      <aside className="sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-56 shrink-0 overflow-y-auto border-r py-8 pr-4 lg:block">
        <DocsNavList />
      </aside>
      <div className="min-w-0 flex-1 py-6 lg:py-10">
        <DocsMobileNav className="mb-6 lg:hidden" />
        {children}
      </div>
    </div>
  );
}
