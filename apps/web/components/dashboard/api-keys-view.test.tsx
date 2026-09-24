import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKey } from "./api-key-types";
import { ApiKeysView } from "./api-keys-view";
import { secretFileContents } from "./one-time-secret-dialog";
import { renderWithQueryClient } from "./test-utils";

const NEW_SECRET = "geo_Secret000000000000000000000000001";
const ALL_ENDPOINTS: ApiKey["endpoints"] = ["geocode", "reverse-geocode", "route"];
const DAY_MS = 24 * 60 * 60 * 1000;

const keys: ApiKey[] = [
  {
    id: "key_1" as ApiKey["id"],
    name: "Production",
    maskedKey: "geo_ab12••••••••••••",
    endpoints: ALL_ENDPOINTS,
    createdAt: Date.UTC(2026, 8, 1),
    lastUsedAt: Date.now() - 120_000,
    expiresAt: null,
    revokedAt: null,
    rateLimitPerMinute: 100,
    requestsLast30Days: 1284,
    requestsThisMinute: 3,
  },
  {
    id: "key_2" as ApiKey["id"],
    name: "Old key",
    maskedKey: "geo_test_zz99••••••••••••",
    endpoints: ALL_ENDPOINTS,
    createdAt: Date.UTC(2026, 6, 1),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: Date.UTC(2026, 7, 1),
    rateLimitPerMinute: 100,
    requestsLast30Days: 0,
    requestsThisMinute: 0,
  },
  {
    id: "key_4" as ApiKey["id"],
    name: "Search widget",
    maskedKey: "geo_cd34••••••••••••",
    endpoints: ["geocode"],
    createdAt: Date.UTC(2026, 5, 1),
    lastUsedAt: null,
    expiresAt: Date.now() - DAY_MS,
    revokedAt: null,
    rateLimitPerMinute: 100,
    requestsLast30Days: 12,
    requestsThisMinute: 0,
  },
];

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  regenerate: vi.fn(),
  rename: vi.fn(),
  revoke: vi.fn(),
  replace: vi.fn(),
}));

vi.mock("convex/react", () => ({
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
  useQuery: (ref: unknown, args: unknown) => (args === "skip" ? undefined : getFunctionName(ref as never) === "apiKeys:list" ? keys : undefined),
  useAction: (ref: unknown) => (getFunctionName(ref as never) === "apiKeys:create" ? mocks.create : mocks.regenerate),
  useMutation: (ref: unknown) => (getFunctionName(ref as never) === "apiKeys:rename" ? mocks.rename : mocks.revoke),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("API keys page", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockResolvedValue({ id: "key_3", secret: NEW_SECRET, maskedKey: "geo_Secr••••••••••••" });
    mocks.revoke.mockResolvedValue(null);
  });

  it("lists keys with masked secrets only", () => {
    renderWithQueryClient(<ApiKeysView />);
    const card = screen.getByRole("group", { name: "API key Production" });
    expect(within(card).getByText("geo_ab12••••••••••••")).toBeInTheDocument();
    expect(within(card).getByText("All endpoints")).toBeInTheDocument();
    expect(within(card).getByText("Never")).toBeInTheDocument();
    expect(within(card).getByText("1,284")).toBeInTheDocument();
    expect(within(card).getByText("3 / 100")).toBeInTheDocument();
    expect(within(card).getByText("100 / min")).toBeInTheDocument();
    expect(screen.getByText("Revoked keys (1)")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("geo_Secret");
  });

  it("shows a key's endpoints and marks it expired", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysView />);
    const card = screen.getByRole("group", { name: "API key Search widget" });
    expect(within(card).getByText("Geocoding")).toBeInTheDocument();
    expect(within(card).queryByText("Routing")).not.toBeInTheDocument();
    expect(within(card).getByText("Expired")).toBeInTheDocument();
    // An expired key cannot get a new secret; it can still be renamed or revoked.
    await user.click(within(card).getByRole("button", { name: "Actions for Search widget" }));
    expect(await screen.findByRole("menuitem", { name: "Revoke" })).toBeInTheDocument();
    expect(screen.queryByRole("menuitem", { name: "Regenerate secret" })).not.toBeInTheDocument();
  });

  it("creates a key for the chosen endpoints that never expires", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysView />);
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    const dialog = await screen.findByRole("dialog", { name: "Create API key" });
    await user.type(within(dialog).getByLabelText("Name"), "Geocoder");
    await user.click(within(dialog).getByRole("checkbox", { name: /Routing/ }));
    await user.click(within(dialog).getByRole("combobox", { name: "Expiration" }));
    await user.click(await screen.findByRole("option", { name: "Never" }));
    expect(within(dialog).getByText("The key never expires. You can revoke it at any time.")).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(mocks.create).toHaveBeenCalledWith({
      name: "Geocoder",
      endpoints: ["geocode", "reverse-geocode"],
      expiresAt: null,
    });
  });

  it("requires at least one endpoint", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysView />);
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    const dialog = await screen.findByRole("dialog", { name: "Create API key" });
    await user.type(within(dialog).getByLabelText("Name"), "Nothing");
    for (const name of [/^Geocoding/, /Reverse geocoding/, /Routing/]) {
      await user.click(within(dialog).getByRole("checkbox", { name }));
    }
    await user.click(within(dialog).getByRole("button", { name: "Create key" }));
    expect(await within(dialog).findByText("Choose at least one endpoint.")).toBeInTheDocument();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("shows a new secret once, with Copy, Download and Done", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText");
    const createObjectURL = vi.fn(() => "blob:key");
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    renderWithQueryClient(<ApiKeysView />);
    await user.click(screen.getByRole("button", { name: "Create API key" }));
    const createDialog = await screen.findByRole("dialog", { name: "Create API key" });
    await user.type(within(createDialog).getByLabelText("Name"), "Mobile backend");
    await user.click(within(createDialog).getByRole("button", { name: "Create key" }));

    // Defaults: every endpoint, expiring in 90 days.
    expect(mocks.create).toHaveBeenCalledWith({ name: "Mobile backend", endpoints: ALL_ENDPOINTS, expiresAt: expect.any(Number) });
    const { expiresAt } = mocks.create.mock.calls[0][0] as { expiresAt: number };
    expect(Math.round((expiresAt - Date.now()) / DAY_MS)).toBe(90);
    const secretDialog = await screen.findByRole("alertdialog", { name: "Save your API key" });
    expect(within(secretDialog).getByDisplayValue(NEW_SECRET)).toBeInTheDocument();
    expect(within(secretDialog).getByText("This secret will not be shown again")).toBeInTheDocument();

    await user.click(within(secretDialog).getByRole("button", { name: "Copy API key" }));
    expect(writeText).toHaveBeenCalledWith(NEW_SECRET);

    await user.click(within(secretDialog).getByRole("button", { name: "Download" }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith("blob:key");

    // Escape must not dismiss the one-time secret.
    await user.keyboard("{Escape}");
    expect(screen.getByRole("alertdialog", { name: "Save your API key" })).toBeInTheDocument();

    await user.click(within(secretDialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    expect(screen.queryByDisplayValue(NEW_SECRET)).not.toBeInTheDocument();
  });

  it("asks for confirmation before revoking", async () => {
    const user = userEvent.setup();
    renderWithQueryClient(<ApiKeysView />);
    await user.click(screen.getByRole("button", { name: "Actions for Production" }));
    await user.click(await screen.findByRole("menuitem", { name: "Revoke" }));
    const confirm = await screen.findByRole("alertdialog", { name: "Revoke “Production”?" });
    expect(mocks.revoke).not.toHaveBeenCalled();
    await user.click(within(confirm).getByRole("button", { name: "Revoke key" }));
    expect(mocks.revoke).toHaveBeenCalledWith({ keyId: "key_1" });
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });

  it("writes the key name, secret and a warning into the download", () => {
    const text = secretFileContents(
      { name: "Mobile backend", secret: NEW_SECRET, regenerated: false },
      new Date("2026-09-24T00:00:00Z"),
    );
    expect(text).toContain("Name:    Mobile backend");
    expect(text).toContain(`Key:     ${NEW_SECRET}`);
    expect(text).toContain("will not be shown again");
  });
});
