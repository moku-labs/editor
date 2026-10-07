import { defineConfig } from "vitest/config";

/**
 * Console lines a test run prints by design: the info entries of the editor's log (`hub:started`,
 * `files:project-on`, `registry:source-unavailable` for a test game without ECS…). Warnings and
 * errors stay visible. The game iframe of the happy-dom tests navigates silently
 * (`navigation.disableChildFrameNavigation`), so happy-dom logs no page load error either.
 */
const EXPECTED_NOISE: readonly RegExp[] = [/^\{\s*level: 'info'/];

/** The colour codes vitest leaves in a console line it hands to `onConsoleLog`. */
const ANSI_COLOUR = new RegExp(String.raw`${String.fromCodePoint(27)}\[[0-9;]*m`, "g");

/**
 * True for a line `EXPECTED_NOISE` names, read without its colour codes.
 *
 * @param log - The console line as vitest formatted it.
 * @returns Whether the run should not print it.
 */
function isExpectedNoise(log: string): boolean {
  const plain = log.replaceAll(ANSI_COLOUR, "");
  return EXPECTED_NOISE.some(noise => noise.test(plain));
}

export default defineConfig({
  test: {
    // Builds dist/ once before any test file (tests/global-build.ts): files never build it.
    globalSetup: ["tests/global-build.ts"],
    onConsoleLog: log => (isExpectedNoise(log) ? false : undefined),
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
