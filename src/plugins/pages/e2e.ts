/**
 * @file pages plugin — `moku-editor e2e -c <playwright config> [playwright args…]` (D-52, D-53):
 * runs a game's editor Playwright specs with one Playwright process per project and spec file, so
 * each spec file gets a fresh editor bin. Bun's dev server degrades after many hot reloads in one
 * process, also within one project (D-53). Each run gets its own `PORT` (the base, else 4417, plus
 * the run's index), because the bin of the previous run can still hold its port for a moment.
 *
 * The plan of runs comes from one `playwright test --list --reporter=json` run with the user's
 * filters: `--project`, file arguments, `-g` and `-G` narrow it. Each (project, file) pair then runs
 * with `--project=<p>`, an anchored file regex and `--pass-with-no-tests`, without the user's
 * `--project` and file words (Playwright would union them with the file regex). One report line
 * per run and a summary go through the brand console. A `--list`, an empty plan, or a config without
 * named projects runs once as given. With `CI=true` the Chromium of the game's Playwright is
 * installed first. Playwright resolves from the game through `bun x`: the editor has no Playwright
 * dependency at run time. The bin installs no signal handler here: a Ctrl+C reaches the Playwright
 * child through the terminal's process group.
 *
 * Two runs in one folder share ports and the game's dev state, so a run takes `.moku/e2e.lock` in
 * the cwd first and a second run refuses while the first lives. A `--list` takes no lock.
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { BrandConsole } from "@moku-labs/common/cli";
import { messageOf } from "./engine-page";
import { isProcessAlive } from "./mcp/discovery";
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
 * Playwright test flags whose next word is always their value.
 */
const VALUE_FLAGS = new Set([
  "-c",
  "--config",
  "-g",
  "--grep",
  "-G",
  "--grep-invert",
  "--global-timeout",
  "-j",
  "--workers",
  "--last-failed-file",
  "--max-failures",
  "--output",
  "--repeat-each",
  "--reporter",
  "--add-reporter",
  "--retries",
  "--run-agents",
  "--shard",
  "--test-list",
  "--test-list-invert",
  "--timeout",
  "--trace",
  "--tsconfig",
  "--ui-host",
  "--ui-port",
  "--update-source-method",
  "--browser"
]);

/**
 * The modes of `-u` / `--update-snapshots`.
 */
const UPDATE_MODES = new Set(["all", "changed", "missing", "none"]);

/**
 * The modes of `--debug`.
 */
const DEBUG_MODES = new Set(["inspector", "cli"]);

/**
 * The reporter flags: the list run drops them, the pair runs keep them.
 */
const REPORTER_FLAGS = new Set(["--reporter", "--add-reporter"]);

/**
 * Flags that pick tests across files: the list run gets them, the pair runs do not.
 */
const LIST_ONLY_FLAGS = new Set(["--shard", "--last-failed"]);

/**
 * A word that names a path: it has a `/` or ends in `.ts`, `.tsx`, `.js` or `.mjs`.
 */
const PATH_LIKE = /(?:\/|\.(?:tsx?|m?js)$)/;

/**
 * The lock file of a run, relative to the cwd.
 */
const LOCK_FILE = ".moku/e2e.lock";

/**
 * The lock that keeps a second e2e run in the same folder from starting while the first lives.
 *
 * @example
 * ```ts
 * // runE2e takes it before anything runs, and releases it after the last run.
 * const lock = fileLock(process.cwd());
 * const holder = await lock.take();
 * if (holder === undefined) {
 *   try {
 *     await deps.run(["playwright", "test", "-c", "pw.config.ts"]);
 *   } finally {
 *     await lock.release();
 *   }
 * } else {
 *   ui.error(`another e2e run (pid ${holder}) holds .moku/e2e.lock`);
 * }
 * ```
 */
export type RunLock = {
  /**
   * Takes the lock, unless a live run holds it. A lock of a dead or unreadable pid is taken over.
   *
   * @returns The pid of the live holder, or undefined when this run took the lock.
   */
  readonly take: () => Promise<number | undefined>;
  /**
   * Releases a lock this run took: removes the file while it still holds this run's pid.
   *
   * @returns Resolves when the file is gone or belongs to another run.
   */
  readonly release: () => Promise<void>;
};

/**
 * What the e2e runner talks to: the environment, the two ways to run `bun x`, and the clock.
 *
 * @example
 * ```ts
 * // A unit test: every run passes, the list has one test of desktop in a.spec.ts.
 * const list = {
 *   config: { rootDir: "/game/e2e", projects: [{ name: "desktop" }] },
 *   suites: [{ specs: [{ file: "a.spec.ts", tests: [{ projectName: "desktop" }] }] }]
 * };
 * const deps: E2eDeps = {
 *   env: {},
 *   run: () => Promise.resolve(0),
 *   capture: () => Promise.resolve({ code: 0, stdout: JSON.stringify(list) }),
 *   now: () => 0
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
  /**
   * The clock of the report lines, in milliseconds; default `performance.now`.
   *
   * @returns The current time.
   */
  readonly now?: () => number;
  /** The lock of the run; absent: no lock. `processE2eDeps` sets `.moku/e2e.lock` in the cwd. */
  readonly lock?: RunLock;
};

/**
 * One run of the plan: a project of the config and a spec file it has tests in.
 *
 * @example
 * ```ts
 * const pair: PlanPair = { project: "chromium-desktop", file: "layout.spec.ts" };
 * ```
 */
export type PlanPair = {
  /** The project name. */
  readonly project: string;
  /** The spec file, relative to the config's `rootDir`. */
  readonly file: string;
};

/**
 * The plan of a list run: the config's `rootDir` and the (project, file) pairs, projects in config
 * order, files in list order.
 *
 * @example
 * ```ts
 * const plan: ListPlan = {
 *   rootDir: "/game/e2e",
 *   pairs: [{ project: "desktop", file: "a.spec.ts" }, { project: "mobile", file: "a.spec.ts" }],
 *   skipped: 0
 * };
 * ```
 */
export type ListPlan = {
  /** The absolute folder the spec files are relative to. */
  readonly rootDir: string;
  /** The runs, in order. */
  readonly pairs: readonly PlanPair[];
  /** The listed tests of an unnamed project: `--project` cannot pick them, so they do not run. */
  readonly skipped: number;
};

/**
 * The user's Playwright words, sorted by what the runner does with them.
 *
 * @example
 * ```ts
 * // moku-editor e2e -c pw.config.ts reload --project desktop -g pick --reporter line --shard 1/2
 * const parts: RestParts = {
 *   projects: ["desktop"],
 *   files: ["reload"],
 *   reporters: ["--reporter", "line"],
 *   listOnly: ["--shard", "1/2"],
 *   other: ["-g", "pick"]
 * };
 * ```
 */
export type RestParts = {
  /** The project names of `--project`: they narrow the list run. */
  readonly projects: string[];
  /** The file filters: they narrow the list run. */
  readonly files: string[];
  /** `--reporter` and `--add-reporter` words: pair runs only. */
  readonly reporters: string[];
  /** `--shard` and `--last-failed` words: the list run only. */
  readonly listOnly: string[];
  /** Every other word: the list run and the pair runs. */
  readonly other: string[];
};

/**
 * One listed test: the project it runs in, "" for an unnamed project.
 */
type ListedTest = { readonly projectName: string };

/**
 * One listed spec: its file, relative to the config's `rootDir`, and its tests, one per project.
 */
type ListedSpec = { readonly file: string; readonly tests: readonly ListedTest[] };

/**
 * A listed suite: a spec file, or a describe inside one.
 */
type ListedSuite = {
  readonly specs?: readonly ListedSpec[];
  readonly suites?: readonly ListedSuite[];
};

/**
 * Playwright's JSON report as far as the runner reads it.
 */
type ListReport = {
  readonly config: {
    readonly rootDir: string;
    readonly projects: readonly { readonly name: string }[];
  };
  readonly suites: readonly ListedSuite[];
};

/**
 * Whether a value is an object with a string `name`.
 *
 * @param value - One entry of `config.projects`.
 * @returns True for a named entry.
 */
function hasName(value: unknown): value is { readonly name: string } {
  return (
    typeof value === "object" && value !== null && "name" in value && typeof value.name === "string"
  );
}

/**
 * Whether a parsed JSON value has a `config.rootDir`, named `config.projects` and a `suites` array.
 * The suites inside follow Playwright's JSON reporter contract.
 *
 * @param value - The parsed JSON.
 * @returns True for a list report.
 */
function isListReport(value: unknown): value is ListReport {
  if (typeof value !== "object" || value === null) return false;
  if (!("config" in value) || !("suites" in value) || !Array.isArray(value.suites)) return false;
  const { config } = value;
  if (typeof config !== "object" || config === null) return false;
  if (!("rootDir" in config) || typeof config.rootDir !== "string") return false;
  return (
    "projects" in config &&
    Array.isArray(config.projects) &&
    config.projects.every(project => hasName(project))
  );
}

/**
 * Every spec of the suites and their nested suites, in list order.
 *
 * @param suites - The listed suites.
 * @returns The specs.
 */
function specsOf(suites: readonly ListedSuite[]): readonly ListedSpec[] {
  return suites.flatMap(suite => [...(suite.specs ?? []), ...specsOf(suite.suites ?? [])]);
}

/**
 * The spec files of each named project, in list order, each once.
 *
 * @param suites - The listed suites.
 * @returns The files by project name.
 */
function filesByProject(suites: readonly ListedSuite[]): Map<string, Set<string>> {
  const files = new Map<string, Set<string>>();
  for (const spec of specsOf(suites)) {
    for (const { projectName } of spec.tests) {
      if (projectName === "") continue; // counted by unnamedTests
      const listed = files.get(projectName) ?? new Set<string>();
      listed.add(spec.file);
      files.set(projectName, listed);
    }
  }
  return files;
}

/**
 * The number of listed tests of an unnamed project.
 *
 * @param suites - The listed suites.
 * @returns The count.
 */
function unnamedTests(suites: readonly ListedSuite[]): number {
  return specsOf(suites).reduce(
    (count, spec) => count + spec.tests.filter(({ projectName }) => projectName === "").length,
    0
  );
}

/**
 * The plan of runs of a `playwright test --list --reporter=json` output: one (project, file) pair
 * per project and spec file with at least one listed test. Projects come in config order, files in
 * list order. Tests of an unnamed project are skipped: `--project` cannot pick it.
 *
 * @param json - The stdout of the list run.
 * @returns The config's `rootDir` and the pairs.
 * @throws {Error} When the text is not JSON or has no `config.rootDir`, `config.projects` or
 * `suites`.
 * @example
 * ```ts
 * const listed = await deps.capture(["playwright", "test", "-c", "pw.config.ts", "--list", "--reporter=json"]);
 * listPlan(listed.stdout);
 * // { rootDir: "/game/e2e", pairs: [{ project: "desktop", file: "a.spec.ts" }, { project: "mobile", file: "a.spec.ts" }], skipped: 0 }
 * ```
 */
export function listPlan(json: string): ListPlan {
  const report: unknown = JSON.parse(json);
  if (!isListReport(report)) {
    throw new Error("the JSON has no config.rootDir, config.projects or suites");
  }

  const files = filesByProject(report.suites);
  const pairs = report.config.projects.flatMap(({ name }) =>
    [...(files.get(name) ?? [])].map(file => ({ project: name, file }))
  );
  return { rootDir: report.config.rootDir, pairs, skipped: unnamedTests(report.suites) };
}

/**
 * Takes the values of a variadic `--project`: every next word up to the first that starts with `-`
 * or looks like a path. That word is a flag or a file filter.
 *
 * @param words - The words after `--project`; the values are removed.
 * @returns The values.
 */
function takeValues(words: string[]): string[] {
  const end = words.findIndex(word => word.startsWith("-") || PATH_LIKE.test(word));
  return words.splice(0, end === -1 ? words.length : end);
}

/**
 * The bucket of a flag.
 *
 * @param flag - The flag, without an `=value`.
 * @param parts - The buckets.
 * @returns The reporters, the list-only words, or the other words.
 */
function bucketOf(flag: string, parts: RestParts): string[] {
  if (REPORTER_FLAGS.has(flag)) return parts.reporters;
  if (LIST_ONLY_FLAGS.has(flag)) return parts.listOnly;
  return parts.other;
}

/**
 * Whether the next word is the value of a flag whose value is optional: `-u` /
 * `--update-snapshots` and `--debug` take one of their modes, `--only-changed` a word that is not a
 * flag and not a spec file.
 *
 * @param flag - The flag, written without `=`.
 * @param next - The next word.
 * @returns True when the next word is the flag's value.
 */
function isOptionalValue(flag: string, next: string): boolean {
  switch (flag) {
    case "-u":
    case "--update-snapshots": {
      return UPDATE_MODES.has(next);
    }
    case "--debug": {
      return DEBUG_MODES.has(next);
    }
    case "--only-changed": {
      return !next.startsWith("-") && !/\.(?:tsx?|js)$/.test(next);
    }
    default: {
      return false;
    }
  }
}

/**
 * Whether a flag takes the next word as its value.
 *
 * @param flag - The flag, written without `=`.
 * @param next - The next word.
 * @returns True for a required value, or an optional value it knows.
 */
function takesValue(flag: string, next: string): boolean {
  return VALUE_FLAGS.has(flag) || isOptionalValue(flag, next);
}

/**
 * Puts a flag into its bucket, with its next word when that is its value.
 *
 * @param word - The flag, maybe with an `=value`.
 * @param words - The words after it; a value taken is removed.
 * @param parts - The buckets.
 */
function takeFlag(word: string, words: string[], parts: RestParts): void {
  const [flag = word] = word.split("=", 1);
  const bucket = bucketOf(flag, parts);
  bucket.push(word);

  const next = words[0];
  if (word === flag && next !== undefined && takesValue(flag, next)) {
    bucket.push(next);
    words.shift();
  }
}

/**
 * Sorts the user's Playwright words into the runner's buckets. `--project X Y…` takes every next
 * word that does not start with `-` (Playwright's variadic rule) up to a word that looks like a path
 * (a `/`, or `.ts`, `.tsx`, `.js`, `.mjs` at the end): that one is a file filter, so a project
 * named like a path needs `--project=X`. `--project=X` takes one. A flag with a
 * required value keeps its next word; `-u` / `--update-snapshots`, `--debug` and `--only-changed`
 * keep it only when it is one of their values. `--flag=value` is one word. Any other word not
 * starting with `-` is a file filter.
 *
 * @param rest - The words for Playwright, without `-c`.
 * @returns The buckets, each in the order given.
 * @example
 * ```ts
 * splitRest(["reload", "--project", "desktop", "-g", "pick", "--reporter=line", "--shard", "1/2"]);
 * // { projects: ["desktop"], files: ["reload"], reporters: ["--reporter=line"],
 * //   listOnly: ["--shard", "1/2"], other: ["-g", "pick"] }
 * ```
 */
export function splitRest(rest: readonly string[]): RestParts {
  const parts: RestParts = { projects: [], files: [], reporters: [], listOnly: [], other: [] };
  const words = [...rest];
  for (let word = words.shift(); word !== undefined; word = words.shift()) {
    if (!word.startsWith("-")) parts.files.push(word);
    else if (word === "--project") parts.projects.push(...takeValues(words));
    else if (word.startsWith("--project=")) parts.projects.push(word.slice("--project=".length));
    else takeFlag(word, words, parts);
  }
  return parts;
}

/**
 * A path with forward slashes, as Playwright tests file regexes on Windows too.
 *
 * @param path - A path.
 * @returns The path with `/` separators.
 */
function posix(path: string): string {
  return path.replaceAll("\\", "/");
}

/**
 * A text with every regex character escaped.
 *
 * @param text - The literal text.
 * @returns The regex source that matches exactly the text.
 */
function escapeRegExp(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * The Playwright file argument that picks one spec file: an anchored regex of its absolute path.
 * Playwright tests a file argument as a regex against the absolute path, so a bare `a.spec.ts`
 * would also pick `xa.spec.ts` and `sub/a.spec.ts`.
 *
 * @param file - The spec file, relative to `rootDir`.
 * @param rootDir - The config's `rootDir`.
 * @returns The regex source.
 * @example
 * ```ts
 * fileFilter("layout.spec.ts", "/game/e2e"); // "^/game/e2e/layout\\.spec\\.ts$"
 * fileFilter("a.spec.ts", "C:\\game\\e2e"); // "^C:/game/e2e/a\\.spec\\.ts$"
 * ```
 */
export function fileFilter(file: string, rootDir: string): string {
  const root = posix(rootDir).replace(/\/$/, "");
  return `^${escapeRegExp(root)}/${escapeRegExp(posix(file))}$`;
}

/**
 * The port of the first run: `PORT` when it is an integer 1-65535, else 4417. Later runs add their
 * index, so a base near 65535 leaves no room for them.
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
 * The plan of the user's tests, or the error line when they cannot be listed. The list run gets
 * the user's filters and list-only flags, not the reporters; `--pass-with-no-tests` makes a filter
 * that matches nothing an empty plan instead of a failed list.
 *
 * @param config - The Playwright config.
 * @param parts - The user's words.
 * @param deps - The e2e deps.
 * @returns The plan, or the `[moku-editor]` message.
 */
async function listTests(
  config: string,
  parts: RestParts,
  deps: E2eDeps
): Promise<ListPlan | string> {
  const failed = `[moku-editor] could not list the tests of ${config}`;
  try {
    const listed = await deps.capture([
      "playwright",
      "test",
      "-c",
      config,
      "--list",
      "--reporter=json",
      "--pass-with-no-tests",
      ...parts.files,
      ...parts.projects.map(project => `--project=${project}`),
      ...parts.other,
      ...parts.listOnly
    ]);
    if (listed.code !== 0) return `${failed}: playwright test --list exited with ${listed.code}`;
    return listPlan(listed.stdout);
  } catch (error) {
    return `${failed}: ${messageOf(error)}`;
  }
}

/**
 * The clock of the report lines: `deps.now`, else `performance.now`.
 *
 * @param deps - The e2e deps.
 * @returns A function that answers the time in milliseconds.
 */
function clockOf(deps: E2eDeps): () => number {
  return deps.now ?? (() => performance.now());
}

/**
 * Milliseconds as seconds with one decimal.
 *
 * @param milliseconds - A duration.
 * @returns The seconds, such as "12.4".
 */
function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(1);
}

/**
 * Runs every pair of the plan, one after another, each with its `PORT` = base + index, and prints
 * one line per run. Every pair runs, also after a failure.
 *
 * @param test - The words of a test run of the config.
 * @param plan - The plan.
 * @param rest - The user's words for each run: no projects, files or list-only flags.
 * @param deps - The e2e deps.
 * @param ui - The branded console.
 * @returns The exit codes, in plan order.
 */
async function runPairs(
  test: readonly string[],
  plan: ListPlan,
  rest: readonly string[],
  deps: E2eDeps,
  ui: BrandConsole
): Promise<readonly number[]> {
  const now = clockOf(deps);
  const base = basePort(deps.env);
  const codes: number[] = [];
  for (const [index, { project, file }] of plan.pairs.entries()) {
    const filter = fileFilter(file, plan.rootDir);
    const started = now();
    const code = await deps.run(
      [...test, `--project=${project}`, filter, "--pass-with-no-tests", ...rest],
      { PORT: String(base + index) }
    );
    const outcome = code === 0 ? "passed" : `failed (code ${code})`;
    const line = `${project} · ${file} · ${outcome} · ${seconds(now() - started)} s`;
    if (code === 0) ui.info(line);
    else ui.error(line);
    codes.push(code);
  }
  return codes;
}

/**
 * In CI, installs the Chromium of the game's Playwright; elsewhere does nothing.
 *
 * @param deps - The e2e deps.
 * @returns The install's exit code, or 0 outside CI.
 */
async function installChromium(deps: E2eDeps): Promise<number> {
  if (deps.env.CI !== "true") return 0;
  return deps.run(["playwright", "install", "chromium"]);
}

/**
 * The CI install, the list run and the runs of the plan, under the lock.
 *
 * @param args - The `e2e` arguments, without `--list`.
 * @param deps - The e2e deps.
 * @param ui - The branded console.
 * @returns The exit code of `runE2e`.
 */
async function runPlan(args: E2eArgs, deps: E2eDeps, ui: BrandConsole): Promise<number> {
  const now = clockOf(deps);
  const started = now();
  const test = ["playwright", "test", "-c", args.config];

  const installed = await installChromium(deps);
  if (installed !== 0) return installed;

  const parts = splitRest(args.rest);
  const plan = await listTests(args.config, parts, deps);
  if (typeof plan === "string") {
    ui.error(plan);
    return 1;
  }

  // Nothing matched, or only an unnamed project has tests: one run as given, and Playwright
  // reports "No tests found" itself.
  if (plan.pairs.length === 0) return deps.run([...test, ...args.rest]);

  const codes = await runPairs(test, plan, [...parts.other, ...parts.reporters], deps, ui);
  const failed = codes.filter(code => code !== 0);
  const summary = `e2e: ${codes.length} runs · ${failed.length} failed · ${seconds(now() - started)} s`;
  if (failed.length === 0) ui.info(summary);
  else ui.error(summary);
  if (plan.skipped > 0) ui.warn(`e2e: ${plan.skipped} tests of an unnamed project did not run`);
  return failed[0] ?? 0;
}

/**
 * Runs the specs of a Playwright config. First it takes `.moku/e2e.lock` (`deps.lock`): while
 * another live run holds it, it refuses with exit 1 and runs nothing. Then in CI the Chromium
 * install, one list run with the user's filters, and one run per (project, file) pair of the list,
 * one after another, each with `PORT` = base + index and `--pass-with-no-tests`. The lock is
 * released after the last run, also after a failure. A `--list` takes no lock and runs once as
 * given, as does a list without tests or a config without named projects. Prints one line per run
 * and a summary.
 *
 * @param args - The `e2e` arguments.
 * @param deps - The environment, the `bun x` runs, the clock and the lock.
 * @param ui - The branded console, for the report and the error line.
 * @returns The exit code: 1 while another run holds the lock; a failed install's code; 1 when the
 * tests cannot be listed; else the first non-zero code of the runs, or 0.
 * @example
 * ```ts
 * // moku-editor e2e -c tests/browser/playwright.config.ts -g pick
 * const args: E2eArgs = { kind: "e2e", config: "tests/browser/playwright.config.ts", rest: ["-g", "pick"] };
 * process.exitCode = await runE2e(args, processE2eDeps(), createBrandConsole());
 * ```
 */
export async function runE2e(args: E2eArgs, deps: E2eDeps, ui: BrandConsole): Promise<number> {
  // A list of the tests runs once as given, without the lock.
  if (args.rest.includes("--list")) {
    const installed = await installChromium(deps);
    if (installed !== 0) return installed;
    return deps.run(["playwright", "test", "-c", args.config, ...args.rest]);
  }

  const holder = await deps.lock?.take();
  if (holder !== undefined) {
    ui.error(
      `[moku-editor] another e2e run (pid ${holder}) holds ${LOCK_FILE}: wait for it, or delete the file when no run is left`
    );
    return 1;
  }
  try {
    return await runPlan(args, deps, ui);
  } finally {
    await deps.lock?.release();
  }
}

/**
 * The error code of a failed file call, such as `EEXIST`.
 *
 * @param error - The thrown value.
 * @returns The code, or undefined.
 */
function codeOf(error: unknown): unknown {
  return error instanceof Error && "code" in error ? error.code : undefined;
}

/**
 * Creates the lock file with this process's pid, only when no file is there (`wx`).
 *
 * @param file - The lock file.
 * @returns True when this call created it, false when it was there.
 */
async function createLockFile(file: string): Promise<boolean> {
  try {
    await writeFile(file, String(process.pid), { flag: "wx" });
    return true;
  } catch (error) {
    if (codeOf(error) === "EEXIST") return false;
    throw error;
  }
}

/**
 * The text of the lock file, or "" when it cannot be read.
 *
 * @param file - The lock file.
 * @returns The text.
 */
async function lockText(file: string): Promise<string> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return "";
  }
}

/**
 * The pid in the lock file when that process lives.
 *
 * @param file - The lock file.
 * @returns The live pid, or undefined for a dead, unreadable or missing one.
 */
async function liveHolder(file: string): Promise<number | undefined> {
  const read = await lockText(file);
  const text = read.trim();
  const pid = /^\d+$/.test(text) ? Number(text) : 0;
  return isProcessAlive(pid) ? pid : undefined;
}

/**
 * Takes the lock file: creates it, or answers its live holder, or removes a stale one and tries
 * again.
 *
 * @param file - The lock file.
 * @returns The pid of the live holder, or undefined when this process took it.
 */
async function acquire(file: string): Promise<number | undefined> {
  if (await createLockFile(file)) return undefined;
  const holder = await liveHolder(file);
  if (holder !== undefined) return holder;
  await rm(file, { force: true }); // a dead or unreadable holder: take the lock over
  return acquire(file);
}

/**
 * The lock of e2e runs in a folder: the file `.moku/e2e.lock` holds the pid of the run that took
 * it. `take` creates the folder and the file exclusively; `release` removes the file only when this
 * lock took it and the file still holds this pid.
 *
 * @param cwd - The folder of the run.
 * @returns The lock.
 * @example
 * ```ts
 * const lock = fileLock("/games/merge");
 * await lock.take(); // undefined: /games/merge/.moku/e2e.lock holds this pid
 * await fileLock("/games/merge").take(); // this pid: a live run holds it
 * await lock.release(); // the file is gone
 * ```
 */
export function fileLock(cwd: string): RunLock {
  const file = path.join(cwd, LOCK_FILE);
  let owned = false;
  return {
    take: async () => {
      await mkdir(path.dirname(file), { recursive: true });
      const holder = await acquire(file);
      owned = holder === undefined;
      return holder;
    },
    release: async () => {
      if (!owned) return;
      owned = false;
      const text = await lockText(file);
      if (text.trim() === String(process.pid)) await rm(file, { force: true });
    }
  };
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
 * The deps of the real process: `Bun.spawn(["bun", "x", …])` in the cwd, env = this process's,
 * clock = `performance.now`, lock = `.moku/e2e.lock` in the cwd.
 *
 * @returns The environment, the two `bun x` runs, the clock and the lock.
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
    },
    now: () => performance.now(),
    lock: fileLock(process.cwd())
  };
}
