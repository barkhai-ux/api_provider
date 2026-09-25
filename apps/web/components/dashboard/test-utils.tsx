import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import type { ReactElement } from "react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { TestI18n } from "@/test/i18n";

/** Renders with the providers the app sets up in its root layout. */
export function renderWithQueryClient(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <TestI18n>
        <TooltipProvider>{ui}</TooltipProvider>
      </TestI18n>
    </QueryClientProvider>,
  );
}
