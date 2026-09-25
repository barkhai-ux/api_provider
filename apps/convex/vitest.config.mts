import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // convex-test runs functions in the same runtime Convex uses.
    environment: "edge-runtime",
    include: ["tests/**/*.test.ts"],
    server: { deps: { inline: ["convex-test"] } },
  },
});
