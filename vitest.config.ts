import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      {
        // An inline project inherits the root config only with `extends: true`.
        extends: true,
        test: {
          name: "unit",
          include: [
            "tests/unit/**/*.test.{ts,tsx}",
            "src/plugins/**/__tests__/unit/**/*.test.{ts,tsx}"
          ],
          exclude: ["**/node_modules/**"]
        }
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: [
            "tests/integration/**/*.test.{ts,tsx}",
            "src/plugins/**/__tests__/integration/**/*.test.{ts,tsx}"
          ],
          exclude: ["**/node_modules/**"]
        }
      }
    ],
    coverage: {
      provider: "istanbul",
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/**/types.ts",
        "src/**/types/**",
        "src/**/__tests__/**",
        "src/plugins/pages/page/**",
        "src/plugins/pages/bin.ts"
      ],
      reporter: ["text", "lcov"],
      thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 }
    }
  }
});
