import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";
import { MERGE_GAME_DIR } from "./tests/fixtures/game-dir";

/**
 * The merge-game fixture lives in a pinned game checkout. tests/fixtures/game-dir.ts holds the one
 * rule for where it is (`MOKU_GAME_DIR`, or the default worktree) and how to set it up. CI has no
 * checkout, so the tests that load the fixture are left out there, with a warning.
 */
const fixture = path.join(MERGE_GAME_DIR, "game.ts");
const hasFixture = existsSync(fixture);

/**
 * Test files that load the merge-game fixture (through loadMergeGame or the registry startGame helper).
 *
 * @returns Paths relative to the repository root.
 */
function fixtureTests(): string[] {
  const root = new URL(".", import.meta.url).pathname;
  const files = ["src", "tests"].flatMap(dir =>
    readdirSync(`${root}${dir}`, { recursive: true, encoding: "utf8" })
      .filter(file => file.endsWith(".test.ts") || file.endsWith(".test.tsx"))
      .map(file => `${dir}/${file}`)
  );
  return files.filter(file =>
    /loadMergeGame|startGame\(/.test(readFileSync(`${root}${file}`, "utf8"))
  );
}

const skipped = hasFixture ? [] : fixtureTests();
if (!hasFixture) {
  console.warn(`merge-game fixture not found at ${fixture}: skipping ${skipped.length} test files`);
}

/**
 * The built entry of the `@moku-labs/game` dev dependency for one subpath.
 *
 * @param subpath - "index", "testing", "inspect", "control", "project", "jsx-runtime" or
 *   "jsx-dev-runtime".
 * @returns The absolute path of dist/<subpath>.mjs inside node_modules.
 */
const game = (subpath: string): string =>
  new URL(`node_modules/@moku-labs/game/dist/${subpath}.mjs`, import.meta.url).pathname;

export default defineConfig({
  // The merge-game fixture (in the game checkout of tests/fixtures/game-dir.ts) imports the
  // engine by its package name from outside this repository. The aliases send the fixture and
  // the editor to the same built files, so both share one copy of the engine modules.
  resolve: {
    alias: [
      { find: "@moku-labs/game/testing", replacement: game("testing") },
      { find: "@moku-labs/game/inspect", replacement: game("inspect") },
      { find: "@moku-labs/game/control", replacement: game("control") },
      { find: "@moku-labs/game/project", replacement: game("project") },
      { find: "@moku-labs/game/jsx-dev-runtime", replacement: game("jsx-dev-runtime") },
      { find: "@moku-labs/game/jsx-runtime", replacement: game("jsx-runtime") },
      { find: /^@moku-labs\/game$/, replacement: game("index") }
    ]
  },
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
          exclude: ["**/node_modules/**", ...skipped]
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
          exclude: ["**/node_modules/**", ...skipped]
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
