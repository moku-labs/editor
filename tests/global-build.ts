/**
 * @file Vitest global setup: builds what the integration tests read from `dist/`, once, before any
 * test file runs. The package entries (`dist/agent-page.mjs` and the rest) come from tsdown without
 * cleaning `dist/`; the tools page (`dist/tools/index.html`) from `scripts/build-tools.ts`. Each
 * step runs only when its output is missing, so a local run after `bun run build` builds nothing.
 *
 * Test files must not build `dist/` themselves: `build-tools.ts` empties `dist/tools` first, so two
 * files building at once delete each other's output (a fresh CI job without `dist/`).
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** The repository root. */
const REPO = fileURLToPath(new URL("..", import.meta.url));

/** One build step: the file it makes and the command that makes it. */
type Step = { readonly output: string; readonly command: readonly string[] };

/** The steps, in order: the package entries, then the tools page. */
const STEPS: readonly Step[] = [
  { output: "dist/agent-page.mjs", command: ["bun", "x", "tsdown", "--no-clean"] },
  { output: "dist/tools/index.html", command: ["bun", "scripts/build-tools.ts"] }
];

/**
 * Runs one step when its output is missing.
 *
 * @param step - The step.
 * @throws {Error} When the command exits with another code than 0.
 */
async function runStep(step: Step): Promise<void> {
  if (existsSync(path.join(REPO, step.output))) return;

  const child = Bun.spawn([...step.command], { cwd: REPO, stdout: "ignore", stderr: "pipe" });
  const [code, errors] = await Promise.all([child.exited, new Response(child.stderr).text()]);
  if (code !== 0)
    throw new Error(`[moku-editor] ${step.command.join(" ")} exited with ${code}: ${errors}`);
}

/**
 * Builds the missing `dist/` outputs before the test files start.
 *
 * @example
 * ```ts
 * // vitest.config.ts
 * test: { globalSetup: ["tests/global-build.ts"] }
 * ```
 */
export default async function globalBuild(): Promise<void> {
  for (const step of STEPS) await runStep(step);
}
