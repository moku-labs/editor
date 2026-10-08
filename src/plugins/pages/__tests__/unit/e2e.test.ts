import { readFileSync } from "node:fs";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { E2eDeps } from "../../e2e";
import { basePort, fileFilter, listPlan, processE2eDeps, runE2e, splitRest } from "../../e2e";
import type { E2eArgs } from "../../types";

/**
 * A real `playwright test --list --reporter=json` output of this repo, trimmed: nested suites,
 * several tests of one file, three named projects and one unnamed project.
 */
const LIST_SAMPLE = readFileSync(
  new URL("../fixtures/playwright-list.json", import.meta.url),
  "utf8"
);

/** The root dir of the stub lists. */
const ROOT = "/repo/e2e";

/**
 * The list JSON of a config: its projects, and the listed tests as (project, file) pairs, each in
 * a nested suite of its file.
 *
 * @param projects - The project names, in config order.
 * @param tests - The listed tests: [project, file], in list order.
 * @returns The JSON text Playwright prints.
 */
function listOf(
  projects: readonly string[],
  tests: readonly (readonly [string, string])[]
): string {
  const files = [...new Set(tests.map(([, file]) => file))];
  const suites = files.map(file => ({
    title: file,
    file,
    specs: [],
    suites: [
      {
        title: "suite",
        file,
        specs: tests
          .filter(([, listed]) => listed === file)
          .map(([projectName]) => ({ title: "t", file, tests: [{ projectName }] }))
      }
    ]
  }));
  return JSON.stringify({
    config: { rootDir: ROOT, projects: projects.map(name => ({ id: name, name })) },
    suites
  });
}

/** The default stub list: four (project, file) pairs over three projects. */
const DEFAULT_LIST = listOf(
  ["desktop", "half", "mobile"],
  [
    ["desktop", "a.spec.ts"],
    ["half", "a.spec.ts"],
    ["desktop", "b.spec.ts"],
    ["mobile", "c.spec.ts"]
  ]
);

/**
 * The e2e arguments of `e2e -c <config> <rest…>`.
 *
 * @param rest - The words for Playwright.
 * @returns The arguments.
 */
function e2eArgs(...rest: readonly string[]): E2eArgs {
  return { kind: "e2e", config: "tests/pw.config.ts", rest };
}

/**
 * Stub deps: every run answers its code in turn (then 0), the list answers `list`, the clock
 * answers `times` in turn (then the last one).
 *
 * @param options - The environment, the run codes, the list answer and the clock.
 * @param options.env - The environment the runner reads.
 * @param options.codes - The exit codes of the runs, in order.
 * @param options.list - What the list run answers, or the error it throws.
 * @param options.times - What `now` answers, in order, in milliseconds.
 * @returns The deps, the console, the recorded console lines.
 */
function stubDeps(
  options: {
    readonly env?: Readonly<Record<string, string>>;
    readonly codes?: readonly number[];
    readonly list?: { code: number; stdout: string } | Error;
    readonly times?: readonly number[];
  } = {}
) {
  const codes = [...(options.codes ?? [])];
  const times = [...(options.times ?? [0])];
  const list = options.list ?? { code: 0, stdout: DEFAULT_LIST };
  const deps = {
    env: options.env ?? {},
    run: vi.fn<E2eDeps["run"]>(() => Promise.resolve(codes.shift() ?? 0)),
    capture: vi.fn<E2eDeps["capture"]>(() =>
      list instanceof Error ? Promise.reject(list) : Promise.resolve(list)
    ),
    now: () => (times.length > 1 ? (times.shift() ?? 0) : (times[0] ?? 0))
  };
  const lines: string[] = [];
  const ui = createBrandConsole({
    write: line => lines.push(line),
    writeError: line => lines.push(line),
    color: false
  });
  return { deps, ui, lines };
}

/** The words of a Playwright test run of the stub config. */
const TEST = ["playwright", "test", "-c", "tests/pw.config.ts"];

/** The words that start the list run of the stub config. */
const LIST = [...TEST, "--list", "--reporter=json", "--pass-with-no-tests"];

/** The anchored filters of the stub files. */
const A = String.raw`^/repo/e2e/a\.spec\.ts$`;
const B = String.raw`^/repo/e2e/b\.spec\.ts$`;
const C = String.raw`^/repo/e2e/c\.spec\.ts$`;

describe("runE2e", () => {
  it("lists the tests with the user's filters, then runs each (project, file) on its own port", async () => {
    const { deps, ui } = stubDeps();
    await expect(runE2e(e2eArgs("-g", "pick"), deps, ui)).resolves.toBe(0);
    expect(deps.capture.mock.calls).toEqual([[[...LIST, "-g", "pick"]]]);
    expect(deps.run.mock.calls).toEqual([
      [[...TEST, "--project=desktop", A, "--pass-with-no-tests", "-g", "pick"], { PORT: "4417" }],
      [[...TEST, "--project=desktop", B, "--pass-with-no-tests", "-g", "pick"], { PORT: "4418" }],
      [[...TEST, "--project=half", A, "--pass-with-no-tests", "-g", "pick"], { PORT: "4419" }],
      [[...TEST, "--project=mobile", C, "--pass-with-no-tests", "-g", "pick"], { PORT: "4420" }]
    ]);
  });

  it("starts at PORT when the env has a valid one", async () => {
    const { deps, ui } = stubDeps({ env: { PORT: "5000" } });
    await runE2e(e2eArgs(), deps, ui);
    expect(deps.run.mock.calls.map(call => call[1])).toEqual([
      { PORT: "5000" },
      { PORT: "5001" },
      { PORT: "5002" },
      { PORT: "5003" }
    ]);
  });

  it("starts at 4417 when PORT is not a port", async () => {
    const { deps, ui } = stubDeps({ env: { PORT: "abc" } });
    await runE2e(e2eArgs(), deps, ui);
    expect(deps.run.mock.calls[0]?.[1]).toEqual({ PORT: "4417" });
  });

  it.each([
    [["--project", "half"]],
    [["--project=half"]]
  ])("narrows to an explicit project %j through the list", async project => {
    const list = { code: 0, stdout: listOf(["desktop", "half"], [["half", "a.spec.ts"]]) };
    const { deps, ui } = stubDeps({ list, codes: [4] });
    await expect(runE2e(e2eArgs(...project, "-g", "x"), deps, ui)).resolves.toBe(4);
    expect(deps.capture.mock.calls).toEqual([[[...LIST, "--project=half", "-g", "x"]]]);
    expect(deps.run.mock.calls).toEqual([
      [[...TEST, "--project=half", A, "--pass-with-no-tests", "-g", "x"], { PORT: "4417" }]
    ]);
  });

  it("hands several projects of a variadic --project to the list", async () => {
    const { deps, ui } = stubDeps();
    await runE2e(e2eArgs("--project", "desktop", "half", "-g", "x"), deps, ui);
    expect(deps.capture.mock.calls).toEqual([
      [[...LIST, "--project=desktop", "--project=half", "-g", "x"]]
    ]);
  });

  it("narrows to a file argument through the list; the runs drop it for their own filter", async () => {
    const list = { code: 0, stdout: listOf(["desktop"], [["desktop", "b.spec.ts"]]) };
    const { deps, ui } = stubDeps({ list });
    await runE2e(e2eArgs("b.spec", "--headed"), deps, ui);
    expect(deps.capture.mock.calls).toEqual([[[...LIST, "b.spec", "--headed"]]]);
    expect(deps.run.mock.calls).toEqual([
      [[...TEST, "--project=desktop", B, "--pass-with-no-tests", "--headed"], { PORT: "4417" }]
    ]);
  });

  it("keeps the user's reporters out of the list run and in each run", async () => {
    const list = { code: 0, stdout: listOf(["desktop"], [["desktop", "a.spec.ts"]]) };
    const { deps, ui } = stubDeps({ list });
    await runE2e(e2eArgs("--reporter", "line", "--add-reporter=html", "-x"), deps, ui);
    expect(deps.capture.mock.calls).toEqual([[[...LIST, "-x"]]]);
    expect(deps.run.mock.calls[0]?.[0]).toEqual([
      ...TEST,
      "--project=desktop",
      A,
      "--pass-with-no-tests",
      "-x",
      "--reporter",
      "line",
      "--add-reporter=html"
    ]);
  });

  it("hands --shard and --last-failed to the list run only", async () => {
    const list = { code: 0, stdout: listOf(["desktop"], [["desktop", "a.spec.ts"]]) };
    const { deps, ui } = stubDeps({ list });
    await runE2e(e2eArgs("--shard", "1/2", "--last-failed", "--shard=2/2", "-x"), deps, ui);
    expect(deps.capture.mock.calls).toEqual([
      [[...LIST, "-x", "--shard", "1/2", "--last-failed", "--shard=2/2"]]
    ]);
    expect(deps.run.mock.calls[0]?.[0]).toEqual([
      ...TEST,
      "--project=desktop",
      A,
      "--pass-with-no-tests",
      "-x"
    ]);
  });

  it("answers the first failing code and still runs the later pairs", async () => {
    const { deps, ui } = stubDeps({ codes: [0, 3, 5, 0] });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(3);
    expect(deps.run).toHaveBeenCalledTimes(4);
  });

  it("prints one line per run and a summary", async () => {
    const list = {
      code: 0,
      stdout: listOf(
        ["desktop", "half"],
        [
          ["desktop", "a.spec.ts"],
          ["half", "a.spec.ts"]
        ]
      )
    };
    const { deps, ui, lines } = stubDeps({
      list,
      codes: [0, 3],
      times: [0, 1000, 3500, 3500, 4000]
    });
    await runE2e(e2eArgs(), deps, ui);
    expect(lines).toEqual([
      expect.stringContaining("desktop · a.spec.ts · passed · 2.5 s"),
      expect.stringContaining("half · a.spec.ts · failed (code 3) · 0.5 s"),
      expect.stringContaining("e2e: 2 runs · 1 failed · 4.0 s")
    ]);
  });

  it("runs once as given, without --pass-with-no-tests, when the list has no test", async () => {
    const list = { code: 0, stdout: listOf(["desktop"], []) };
    const { deps, ui, lines } = stubDeps({ list, codes: [1] });
    await expect(runE2e(e2eArgs("-g", "nope"), deps, ui)).resolves.toBe(1);
    expect(deps.run.mock.calls).toEqual([[[...TEST, "-g", "nope"]]]);
    expect(lines).toEqual([]);
  });

  it("runs once as given when the config has no named project", async () => {
    const list = { code: 0, stdout: listOf([""], [["", "a.spec.ts"]]) };
    const { deps, ui } = stubDeps({ list, codes: [2] });
    await expect(runE2e(e2eArgs("--headed"), deps, ui)).resolves.toBe(2);
    expect(deps.run.mock.calls).toEqual([[[...TEST, "--headed"]]]);
  });

  it("runs a --list once as given, without a list run", async () => {
    const { deps, ui } = stubDeps({ codes: [0] });
    await expect(runE2e(e2eArgs("--list", "-g", "x"), deps, ui)).resolves.toBe(0);
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.run.mock.calls).toEqual([[[...TEST, "--list", "-g", "x"]]]);
  });

  it("installs Chromium first with CI=true", async () => {
    const { deps, ui } = stubDeps({ env: { CI: "true" } });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(0);
    expect(deps.run.mock.calls[0]).toEqual([["playwright", "install", "chromium"]]);
    expect(deps.run).toHaveBeenCalledTimes(5);
  });

  it("answers the code of a failed install and runs nothing else", async () => {
    const { deps, ui } = stubDeps({ env: { CI: "true" }, codes: [7] });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(7);
    expect(deps.run).toHaveBeenCalledTimes(1);
    expect(deps.capture).not.toHaveBeenCalled();
  });

  it("installs nothing without CI=true", async () => {
    const { deps, ui } = stubDeps({ env: { CI: "1" } });
    await runE2e(e2eArgs(), deps, ui);
    expect(deps.run.mock.calls.map(call => call[0][1])).toEqual(["test", "test", "test", "test"]);
  });

  it("answers 1 with the message when the list run fails", async () => {
    const { deps, ui, lines } = stubDeps({ list: { code: 1, stdout: "" } });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(1);
    expect(deps.run).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain(
      "[moku-editor] could not list the tests of tests/pw.config.ts: playwright test --list exited with 1"
    );
  });

  it("answers 1 with the message when the list is not JSON, or the list run throws", async () => {
    const bad = stubDeps({ list: { code: 0, stdout: "Error: no config" } });
    await expect(runE2e(e2eArgs(), bad.deps, bad.ui)).resolves.toBe(1);
    expect(bad.lines.join("\n")).toContain(
      "[moku-editor] could not list the tests of tests/pw.config.ts: "
    );
    const thrown = stubDeps({ list: new Error("spawn bun ENOENT") });
    await expect(runE2e(e2eArgs(), thrown.deps, thrown.ui)).resolves.toBe(1);
    expect(thrown.lines.join("\n")).toContain("spawn bun ENOENT");
    expect(thrown.deps.run).not.toHaveBeenCalled();
  });
});

describe("listPlan", () => {
  it("reads the (project, file) pairs of a real list output: config order, list order, no unnamed project", () => {
    expect(listPlan(LIST_SAMPLE)).toEqual({
      rootDir: "/repo/e2e",
      pairs: [
        { project: "chromium-desktop", file: "layout.spec.ts" },
        { project: "chromium-desktop", file: "no-js-errors.spec.ts" },
        { project: "chromium-desktop", file: "pane.spec.ts" },
        { project: "chromium-desktop", file: "shell.spec.ts" },
        { project: "chromium-half", file: "layout.spec.ts" },
        { project: "chromium-half", file: "pane.spec.ts" },
        { project: "chromium-mobile", file: "no-js-errors.spec.ts" }
      ]
    });
  });

  it("orders the projects as the config does, even when the list reports another one first", () => {
    const json = listOf(
      ["desktop", "mobile"],
      [
        ["mobile", "a.spec.ts"],
        ["desktop", "b.spec.ts"],
        ["desktop", "a.spec.ts"]
      ]
    );
    expect(listPlan(json).pairs).toEqual([
      { project: "desktop", file: "a.spec.ts" },
      { project: "desktop", file: "b.spec.ts" },
      { project: "mobile", file: "a.spec.ts" }
    ]);
  });

  it("makes one pair of several tests of one file", () => {
    const json = listOf(
      ["desktop"],
      [
        ["desktop", "a.spec.ts"],
        ["desktop", "a.spec.ts"],
        ["desktop", "a.spec.ts"]
      ]
    );
    expect(listPlan(json).pairs).toEqual([{ project: "desktop", file: "a.spec.ts" }]);
  });

  it("answers no pair for a list without tests", () => {
    expect(listPlan(listOf(["desktop"], []))).toEqual({ rootDir: ROOT, pairs: [] });
  });

  it.each([
    "not json",
    "{}",
    "null",
    '{"config":{"rootDir":"/r","projects":[]}}',
    '{"config":{"projects":[]},"suites":[]}'
  ])("throws on %j", text => {
    expect(() => listPlan(text)).toThrow(Error);
  });
});

describe("splitRest", () => {
  it.each([
    [["--project", "a"], { projects: ["a"] }],
    [["--project=a"], { projects: ["a"] }],
    [["--project", "a", "b", "-g", "pick"], { projects: ["a", "b"], other: ["-g", "pick"] }],
    [["--project", "a", "reload.ts"], { projects: ["a", "reload.ts"] }],
    [["--project=a", "reload.ts"], { projects: ["a"], files: ["reload.ts"] }],
    [["-g", "pick"], { other: ["-g", "pick"] }],
    [["-g=pick"], { other: ["-g=pick"] }],
    [["--grep-invert", "slow", "x"], { other: ["--grep-invert", "slow"], files: ["x"] }],
    [["-u", "all"], { other: ["-u", "all"] }],
    [["-u", "reload.ts"], { other: ["-u"], files: ["reload.ts"] }],
    [["--update-snapshots", "changed"], { other: ["--update-snapshots", "changed"] }],
    [["--debug", "cli", "x"], { other: ["--debug", "cli"], files: ["x"] }],
    [["--debug", "x"], { other: ["--debug"], files: ["x"] }],
    [["--repeat-each", "3"], { other: ["--repeat-each", "3"] }],
    [["--only-changed", "main"], { other: ["--only-changed", "main"] }],
    [["--only-changed", "reload.ts"], { other: ["--only-changed"], files: ["reload.ts"] }],
    [["--only-changed", "-x"], { other: ["--only-changed", "-x"] }],
    [["reload"], { files: ["reload"] }],
    [["--headed"], { other: ["--headed"] }],
    [
      ["--reporter", "line", "--add-reporter=dot"],
      { reporters: ["--reporter", "line", "--add-reporter=dot"] }
    ],
    [["--shard", "1/2", "--last-failed"], { listOnly: ["--shard", "1/2", "--last-failed"] }],
    [["--shard=1/2"], { listOnly: ["--shard=1/2"] }],
    [["-g"], { other: ["-g"] }]
  ])("splits %j", (rest, buckets) => {
    expect(splitRest(rest)).toEqual({
      projects: [],
      files: [],
      reporters: [],
      listOnly: [],
      other: [],
      ...buckets
    });
  });
});

describe("fileFilter", () => {
  it("anchors the escaped file under the root dir", () => {
    expect(fileFilter("a.spec.ts", "/repo/e2e")).toBe(String.raw`^/repo/e2e/a\.spec\.ts$`);
    expect(fileFilter("(x)+[y].ts", "/r")).toBe(String.raw`^/r/\(x\)\+\[y\]\.ts$`);
  });

  it("matches its own file only", () => {
    const filter = new RegExp(fileFilter("a.spec.ts", "/repo/e2e"), "i");
    expect(filter.test("/repo/e2e/a.spec.ts")).toBe(true);
    expect(filter.test("/repo/e2e/sub/a.spec.ts")).toBe(false);
    expect(filter.test("/repo/e2e/xa.spec.ts")).toBe(false);
    expect(filter.test("/repo/e2e/aXspec.ts")).toBe(false);
    const nested = new RegExp(fileFilter("sub/a.spec.ts", "/repo/e2e"), "i");
    expect(nested.test("/repo/e2e/sub/a.spec.ts")).toBe(true);
    expect(nested.test("/repo/e2e/a.spec.ts")).toBe(false);
  });

  it("writes a Windows root dir with forward slashes, as Playwright tests it", () => {
    expect(fileFilter(String.raw`sub\a.spec.ts`, String.raw`C:\repo\e2e`)).toBe(
      String.raw`^C:/repo/e2e/sub/a\.spec\.ts$`
    );
  });
});

describe("basePort", () => {
  it.each([
    [{}, 4417],
    [{ PORT: "5000" }, 5000],
    [{ PORT: "1" }, 1],
    [{ PORT: "65535" }, 65_535],
    [{ PORT: "0" }, 4417],
    [{ PORT: "65536" }, 4417],
    [{ PORT: "3.5" }, 4417],
    [{ PORT: "" }, 4417],
    [{ PORT: " 80" }, 4417]
  ])("reads %j as %i", (env, port) => {
    expect(basePort(env)).toBe(port);
  });
});

describe("processE2eDeps", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the process env", () => {
    vi.stubEnv("MOKU_E2E_PROBE", "on");
    expect(processE2eDeps().env.MOKU_E2E_PROBE).toBe("on");
  });

  it("reads the clock in milliseconds", () => {
    const now = processE2eDeps().now;
    const before = performance.now();
    const read = now?.() ?? -1;
    expect(read).toBeGreaterThanOrEqual(before);
    expect(read).toBeLessThanOrEqual(performance.now());
  });

  it("runs `bun x` with the bin's env plus the extra variables, and answers the exit code", async () => {
    vi.stubEnv("MOKU_E2E_PROBE", "3");
    const script = "process.exit(Number(process.env.MOKU_E2E_PROBE) + Number(process.env.PORT))";
    await expect(processE2eDeps().run(["bun", "-e", script], { PORT: "4" })).resolves.toBe(7);
  });

  it("captures the stdout and code of `bun x`, without the Playwright JSON output variables", async () => {
    vi.stubEnv("MOKU_E2E_PROBE", "kept");
    vi.stubEnv("PLAYWRIGHT_JSON_OUTPUT_NAME", "out.json");
    vi.stubEnv("PLAYWRIGHT_JSON_OUTPUT_DIR", "out");
    vi.stubEnv("PLAYWRIGHT_JSON_OUTPUT_FILE", "out/x.json");
    const names = [
      "MOKU_E2E_PROBE",
      "PLAYWRIGHT_JSON_OUTPUT_NAME",
      "PLAYWRIGHT_JSON_OUTPUT_DIR",
      "PLAYWRIGHT_JSON_OUTPUT_FILE"
    ];
    const script = `console.log(${JSON.stringify(names)}.map(n => process.env[n] ?? "-").join(" ")); process.exit(2);`;
    const { code, stdout } = await processE2eDeps().capture(["bun", "-e", script]);
    expect(code).toBe(2);
    expect(stdout.trim()).toBe("kept - - -");
  });
});
