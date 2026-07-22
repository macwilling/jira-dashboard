import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [react(), tsconfigPaths()],
  test: {
    // Default to node; suites that need the DOM opt in with a
    // `// @vitest-environment jsdom` comment at the top of the file.
    environment: "node",
    globals: true,
    setupFiles: ["./vitest.setup.ts"],
    include: ["**/*.{test,spec}.{ts,tsx}"],
    exclude: ["node_modules", ".next", "cron"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["lib/**/*.{ts,tsx}", "app/**/*.{ts,tsx}"],
      // Exclude things that aren't meaningfully unit-testable in isolation:
      // type-only modules, test files/helpers, and shadcn/ui primitives.
      exclude: [
        "**/*.d.ts",
        "**/*.{test,spec}.{ts,tsx}",
        "lib/**/types.ts",
        "lib/types.ts",
        "components/ui/**",
        "test/**",
      ],
    },
  },
});
