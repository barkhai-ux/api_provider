import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { getFunctionName } from "convex/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKey } from "./api-key-types";
import { ApiKeysView } from "./api-keys-view";
import { secretFileContents } from "./one-time-secret-dialog";
import { renderWithQueryClient } from "./test-utils";

const NEW_SECRET = "geo_live_Secret0000000000000000000000000001";

const keys: ApiKey[] = [
  {
    id: "key_1" as ApiKey["id"],
    name: "Production",
    maskedKey: "geo_live_ab12••••••••••••",
    environment: "live",
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
    environment: "test",
    createdAt: Date.UTC(2026, 6, 1),
    lastUsedAt: null,
    expiresAt: null,
    revokedAt: Date.UTC(2026, 7, 1),
    rateLimitPerMinute: 100,
    requestsLast30Days: 0,
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
    mocks.create.mockResolvedValue({ id: "key_3", secret: NEW_SECRET, maskedKey: "geo_live_Secr••••••••••••" });
    mocks.revoke.mockResolvedValue(null);
  });

  it("lists keys with masked secrets only", () => {
    renderWithQueryClient(<ApiKeysView />);
    const card = screen.getByRole("group", { name: "API key Production" });
    expect(within(card).getByText("geo_live_ab12••••••••••••")).toBeInTheDocument();
    expect(within(card).getByText("1,284")).toBeInTheDocument();
    expect(within(card).getByText("3 / 100")).toBeInTheDocument();
    expect(within(card).getByText("100 / min")).toBeInTheDocument();
    expect(screen.getByText("Revoked keys (1)")).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("geo_live_Secret");
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

    expect(mocks.create).toHaveBeenCalledWith({ name: "Mobile backend", environment: "live" });
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
