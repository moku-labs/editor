/**
 * @file pages plugin — `moku-editor e2e -c <playwright config> [playwright args…]` (D-52): runs a
 * game's editor Playwright specs with one Playwright process per project of the config, so each
 * project gets a fresh editor bin. Bun 1.3.14's dev server crashes after many hot reloads in one
 * process. Each project runs on its own `PORT` (the base, else 4417, plus the project's index),
 * because the bin of the previous project can still hold its port for a moment.
 *
 * An explicit `--project` or a `--list` runs once as given; each per-project run adds
 * `--pass-with-no-tests`; every other word goes to Playwright. With `CI=true`
 * the Chromium of the game's Playwright is installed first. Playwright resolves from the game
 * through `bun x`: the editor has no Playwright dependency at run time. The bin installs no signal
 * handler here: a Ctrl+C reaches the Playwright child through the terminal's process group.
 */
import type { BrandConsole } from "@moku-labs/common/cli";
import { messageOf } from "./engine-page";
import type { E2eArgs } from "./types";

/**
 * The first port when the environment has no valid `PORT`.
 */
const DEFAULT_BASE_PORT = 4417;

/**
 * The highest TCP port.
 */
const PORT_MAX = 65_535;

/**
 * Variables that make Playwright's JSON reporter write a file instead of stdout: the list run
 * drops them.
 */
const JSON_OUTPUT_ENV = new Set([
  "PLAYWRIGHT_JSON_OUTPUT_NAME",
  "PLAYWRIGHT_JSON_OUTPUT_DIR",
  "PLAYWRIGHT_JSON_OUTPUT_FILE"
]);

/**
 * What the e2e runner talks to: the environment and the two ways to run `bun x`.
 *
 * @example
 * ```ts
 * // A unit test: every run passes, the config has one project.
 * const deps: E2eDeps = {
 *   env: {},
 *   run: () => Promise.resolve(0),
 *   capture: () => Promise.resolve({ code: 0, stdout: '{"config":{"projects":[{"name":"desktop"}]}}' })
 * };
 * await runE2e({ kind: "e2e", config: "pw.config.ts", rest: [] }, deps, ui); // 0
 * ```
 */
export type E2eDeps = {
  /** The bin's environment: `CI` and `PORT` are read. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /**
   * Runs `bun x <args>` in the cwd with the terminal attached.
   *
   * @param args - The words after `bun x`.
   * @param extra - Variables merged over the bin's environment.
   * @returns The exit code.
   */
  readonly run: (
    args: readonly string[],
    extra?: Readonly<Record<string, string>>
  ) => Promise<number>;
  /**
   * Runs `bun x <args>` in the cwd and captures its stdout; stderr stays on the terminal.
   *
   * @param args - The words after `bun x`.
   * @returns The exit code and the stdout text.
   */
  readonly capture: (args: readonly string[]) => Promise<{ code: number; stdout: string }>;
};

/**
 * Playwright's JSON report as far as the runner reads it: the projects of the config.
 */
type ListReport = { readonly config: { readonly projects: readonly unknown[] } };

/**
 * Whether a parsed JSON value has a `config.projects` array.
 *
 * @param value - The parsed JSON.
 * @returns True for a list report.
 */
function isListReport(value: unknown): value is ListReport {
  if (typeof value !== "object" || value === null || !("config" in value)) return false;
  const { config } = value;
  if (typeof config !== "object" || config === null || !("projects" in config)) return false;
  return Array.isArray(config.projects);
}

/**
 * The name of one listed project, or "" when it has none.
 *
 * @param project - One entry of `config.projects`.
 * @returns The name.
 */
function nameOf(project: unknown): string {
  if (typeof project !== "object" || project === null || !("name" in project)) return "";
  return typeof project.name === "string" ? project.name : "";
}

/**
 * The project names of a `playwright test --list --reporter=json` output, in config order. A
 * project without a name is skipped.
 *
 * @param json - The stdout of the list run.
 * @returns The names.
 * @throws {Error} When the text is not JSON or has no `config.projects` array.
 * @example
 * ```ts
 * projectNames('{"config":{"projects":[{"name":"desktop"},{"name":""},{"name":"mobile"}]}}'); // ["desktop", "mobile"]
 * ```
 */
export function projectNames(json: string): readonly string[] {
  const report: unknown = JSON.parse(json);
  if (!isListReport(report)) throw new Error("the JSON has no config.projects");
  return report.config.projects.map(project => nameOf(project)).filter(name => name !== "");
}

/**
 * The port of the first project: `PORT` when it is an integer 1-65535, else 4417. Later projects
 * add their index, so a base near 65535 leaves no room for them.
 *
 * @param env - The bin's environment.
 * @returns The base port.
 * @example
 * ```ts
 * basePort({ PORT: "5000" }); // 5000
 * basePort({ PORT: "abc" }); // 4417
 * ```
 */
export function basePort(env: E2eDeps["env"]): number {
  const value = env.PORT;
  if (value === undefined || !/^\d{1,5}$/.test(value)) return DEFAULT_BASE_PORT;

  const port = Number(value);
  return port >= 1 && port <= PORT_MAX ? port : DEFAULT_BASE_PORT;
}

/**
 * Whether Playwright's words pick a project themselves: `--project x` or `--project=x`.
 *
 * @param rest - The words for Playwright.
 * @returns True when one of them is `--project` or starts with `--project=`.
 * @example
 * ```ts
 * hasProject(["--project=chromium-desktop", "-g", "pick"]); // true
 * hasProject(["-g", "pick"]); // false
 * ```
 */
export function hasProject(rest: readonly string[]): boolean {
  return rest.some(word => word === "--project" || word.startsWith("--project="));
}

/**
 * The project names of the config, or the error line when they cannot be listed.
 *
 * @param config - The Playwright config.
 * @param deps - The e2e deps.
 * @returns The names, or the `[moku-editor]` message.
 */
async function listProjects(config: string, deps: E2eDeps): Promise<readonly string[] | string> {
  const failed = `[moku-editor] could not list the projects of ${config}`;
  try {
    const listed = await deps.capture([
      "playwright",
      "test",
      "-c",
      config,
      "--list",
      "--reporter=json"
    ]);
    if (listed.code !== 0) return `${failed}: playwright test --list exited with ${listed.code}`;
    return projectNames(listed.stdout);
  } catch (error) {
    return `${failed}: ${messageOf(error)}`;
  }
}

/**
 * Runs the specs of a Playwright config: in CI the Chromium install first, then one run per
 * project, one after another, each with `PORT` = base + index and `--pass-with-no-tests` (a
 * project with no test for the filter passes). An explicit `--project`, a `--list`, or a config
 * without named projects, runs once as given.
 *
 * @param args - The `e2e` arguments.
 * @param deps - The environment and the `bun x` runs.
 * @param ui - The branded console, for the error line.
 * @returns The exit code: a failed install's code; 1 when the projects cannot be listed; else the
 * first non-zero code of the runs, or 0.
 * @example
 * ```ts
 * // moku-editor e2e -c tests/browser/playwright.config.ts -g pick
 * const args: E2eArgs = { kind: "e2e", config: "tests/browser/playwright.config.ts", rest: ["-g", "pick"] };
 * process.exitCode = await runE2e(args, processE2eDeps(), createBrandConsole());
 * ```
 */
export async function runE2e(args: E2eArgs, deps: E2eDeps, ui: BrandConsole): Promise<number> {
  const test = ["playwright", "test", "-c", args.config];

  // In CI the game's Playwright needs its Chromium first.
  if (deps.env.CI === "true") {
    const installed = await deps.run(["playwright", "install", "chromium"]);
    if (installed !== 0) return installed;
  }

  // An explicit project, or a list of the tests, runs once as given.
  if (hasProject(args.rest) || args.rest.includes("--list"))
    return deps.run([...test, ...args.rest]);

  const projects = await listProjects(args.config, deps);
  if (typeof projects === "string") {
    ui.error(projects);
    return 1;
  }
  if (projects.length === 0) return deps.run([...test, ...args.rest]);

  // Every project runs, also after a failure; the first failure decides the code. A project with
  // no test for the filter (a layout-only project under `-g`) passes instead of failing the run.
  const base = basePort(deps.env);
  let code = 0;
  for (const [index, project] of projects.entries()) {
    const port = String(base + index);
    const ran = await deps.run(
      [...test, "--project", project, "--pass-with-no-tests", ...args.rest],
      {
        PORT: port
      }
    );
    if (code === 0) code = ran;
  }
  return code;
}

/**
 * The environment of the list run: the bin's, without the variables that send the JSON report to
 * a file.
 *
 * @returns The environment.
 */
function listEnvironment(): Record<string, string | undefined> {
  const env = Object.entries(process.env); // @env-allow — handed on to the list run
  return Object.fromEntries(env.filter(([name]) => !JSON_OUTPUT_ENV.has(name)));
}

/**
 * The deps of the real process: `Bun.spawn(["bun", "x", …])` in the cwd, env = this process's.
 *
 * @returns The environment and the two `bun x` runs.
 * @example
 * ```ts
 * const code = await runE2e(args, processE2eDeps(), createBrandConsole());
 * ```
 */
export function processE2eDeps(): E2eDeps {
  return {
    env: process.env, // @env-allow — CI and PORT of the bin
    run: async (args, extra = {}) => {
      const child = Bun.spawn(["bun", "x", ...args], {
        env: { ...process.env, ...extra }, // @env-allow — handed on to Playwright
        stdio: ["inherit", "inherit", "inherit"]
      });
      return child.exited;
    },
    capture: async args => {
      const child = Bun.spawn(["bun", "x", ...args], {
        env: listEnvironment(),
        stdio: ["inherit", "pipe", "inherit"]
      });
      const [stdout, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
      return { code, stdout };
    }
  };
}
