import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { TestI18n } from "@/test/i18n";
import { LoginForm } from "./login-form";

const mocks = vi.hoisted(() => ({ signIn: vi.fn(), replace: vi.fn(), next: null as string | null }));

vi.mock("@convex-dev/auth/react", () => ({ useAuthActions: () => ({ signIn: mocks.signIn, signOut: vi.fn() }) }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(mocks.next ? { next: mocks.next } : {}),
}));

function renderForm() {
  const client = new QueryClient();
  return render(
    <QueryClientProvider client={client}>
      <TestI18n>
        <LoginForm />
      </TestI18n>
    </QueryClientProvider>,
  );
}

describe("LoginForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.next = null;
  });

  it("never puts credentials in the URL, even before scripts load", () => {
    // Without JavaScript a form submits natively; GET would put the email and
    // password in the address bar, history and server logs.
    const { container } = renderForm();
    expect(container.querySelector("form")).toHaveAttribute("method", "post");
  });

  it("validates the fields before calling the server", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter your email address.")).toBeInTheDocument();
    expect(screen.getByText("Enter your password.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Email"), "not-an-email");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(mocks.signIn).not.toHaveBeenCalled();
  });

  it("shows one generic message for a wrong email or password", async () => {
    mocks.signIn.mockRejectedValue(new Error("InvalidCredentials"));
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "dev@example.com");
    await user.type(screen.getByLabelText("Password"), "wrong-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    expect(await screen.findByText("The email or password is incorrect.")).toBeInTheDocument();
    expect(mocks.signIn).toHaveBeenCalledWith("password", {
      email: "dev@example.com",
      password: "wrong-password",
      flow: "signIn",
    });
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it("continues to a safe next page after signing in", async () => {
    mocks.signIn.mockResolvedValue({ signingIn: true });
    mocks.next = "/dashboard/api-keys";
    const user = userEvent.setup();
    renderForm();
    await user.type(screen.getByLabelText("Email"), "Dev@Example.com ");
    await user.type(screen.getByLabelText("Password"), "correct-password");
    await user.click(screen.getByRole("button", { name: "Sign in" }));
    await vi.waitFor(() => expect(mocks.replace).toHaveBeenCalledWith("/dashboard/api-keys"));
  });
});
