import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DOCS_NAV } from "@/lib/docs-nav";
import { DocsMobileNav, DocsNavList } from "./docs-nav";

const navigation = vi.hoisted(() => ({ pathname: "/developers/docs/geocoding" }));

vi.mock("next/navigation", () => ({
  usePathname: () => navigation.pathname,
}));

describe("docs navigation", () => {
  beforeEach(() => {
    navigation.pathname = "/developers/docs/geocoding";
  });

  it("lists every documentation section", () => {
    render(<DocsNavList />);
    const nav = screen.getByRole("navigation", { name: "Documentation" });
    for (const item of DOCS_NAV.flatMap((section) => section.items)) {
      expect(within(nav).getByRole("link", { name: item.title })).toHaveAttribute("href", item.href);
    }
  });

  it("marks only the current page as active", () => {
    render(<DocsNavList />);
    expect(screen.getByRole("link", { name: "Geocoding" })).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("link", { name: "Routing" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Introduction" })).not.toHaveAttribute("aria-current");
  });

  it("treats a trailing slash as the same page", () => {
    navigation.pathname = "/developers/docs/";
    render(<DocsNavList />);
    expect(screen.getByRole("link", { name: "Introduction" })).toHaveAttribute("aria-current", "page");
  });

  it("collapses into a sheet on small screens", async () => {
    const user = userEvent.setup();
    render(<DocsMobileNav />);
    expect(screen.getByText("Geocoding")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /docs menu/i }));
    const dialog = await screen.findByRole("dialog");
    const active = within(dialog).getByRole("link", { name: "Geocoding" });
    expect(active).toHaveAttribute("aria-current", "page");
  });
});
