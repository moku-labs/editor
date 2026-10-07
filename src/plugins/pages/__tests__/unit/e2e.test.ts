import { readFileSync } from "node:fs";
import { createBrandConsole } from "@moku-labs/common/cli";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { E2eDeps } from "../../e2e";
import { basePort, hasProject, processE2eDeps, projectNames, runE2e } from "../../e2e";
import type { E2eArgs } from "../../types";

/** A real `playwright test --list --reporter=json` output, trimmed: projects with and without a name. */
const LIST_SAMPLE = readFileSync(
  new URL("../fixtures/playwright-list.json", import.meta.url),
  "utf8"
);

/**
 * The list JSON of a config with these project names.
 *
 * @param names - The project names, in config order.
 * @returns The JSON text Playwright prints.
 */
function listOf(names: readonly string[]): string {
  return JSON.stringify({ config: { projects: names.map(name => ({ id: name, name })) } });
}

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
 * Stub deps: every run answers its code in turn (then 0), the list answers `list`.
 *
 * @param options - The environment, the run codes and the list answer.
 * @param options.env - The environment the runner reads.
 * @param options.codes - The exit codes of the runs, in order.
 * @param options.list - What the list run answers, or the error it throws.
 * @returns The deps, the recorded console lines.
 */
function stubDeps(
  options: {
    readonly env?: Readonly<Record<string, string>>;
    readonly codes?: readonly number[];
    readonly list?: { code: number; stdout: string } | Error;
  } = {}
) {
  const codes = [...(options.codes ?? [])];
  const list = options.list ?? { code: 0, stdout: listOf(["desktop", "half", "mobile"]) };
  const deps = {
    env: options.env ?? {},
    run: vi.fn<E2eDeps["run"]>(() => Promise.resolve(codes.shift() ?? 0)),
    capture: vi.fn<E2eDeps["capture"]>(() =>
      list instanceof Error ? Promise.reject(list) : Promise.resolve(list)
    )
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

describe("runE2e", () => {
  it("lists the projects, then runs each one after another on its own port from 4417", async () => {
    const { deps, ui } = stubDeps();
    await expect(runE2e(e2eArgs("-g", "pick"), deps, ui)).resolves.toBe(0);
    expect(deps.capture).toHaveBeenCalledWith([...TEST, "--list", "--reporter=json"]);
    expect(deps.run.mock.calls).toEqual([
      [[...TEST, "--project", "desktop", "--pass-with-no-tests", "-g", "pick"], { PORT: "4417" }],
      [[...TEST, "--project", "half", "--pass-with-no-tests", "-g", "pick"], { PORT: "4418" }],
      [[...TEST, "--project", "mobile", "--pass-with-no-tests", "-g", "pick"], { PORT: "4419" }]
    ]);
  });

  it("hands each run only its PORT: the runner merges it over the bin's env", async () => {
    const { deps, ui } = stubDeps({ list: { code: 0, stdout: listOf(["desktop"]) } });
    await runE2e(e2eArgs(), deps, ui);
    expect(deps.run).toHaveBeenCalledWith(
      [...TEST, "--project", "desktop", "--pass-with-no-tests"],
      { PORT: "4417" }
    );
  });

  it("starts at PORT when the env has a valid one", async () => {
    const { deps, ui } = stubDeps({ env: { PORT: "5000" } });
    await runE2e(e2eArgs(), deps, ui);
    expect(deps.run.mock.calls.map(call => call[1])).toEqual([
      { PORT: "5000" },
      { PORT: "5001" },
      { PORT: "5002" }
    ]);
  });

  it("starts at 4417 when PORT is not a port", async () => {
    const { deps, ui } = stubDeps({ env: { PORT: "abc" } });
    await runE2e(e2eArgs(), deps, ui);
    expect(deps.run.mock.calls[0]?.[1]).toEqual({ PORT: "4417" });
  });

  it.each([
    ["--project", "half"],
    ["--project=half"]
  ])("runs once as given with an explicit %s, without a list", async (...project) => {
    const { deps, ui } = stubDeps({ codes: [4] });
    await expect(runE2e(e2eArgs(...project, "-g", "x"), deps, ui)).resolves.toBe(4);
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.run.mock.calls).toEqual([[[...TEST, ...project, "-g", "x"]]]);
  });

  it("runs a --list once as given, without a list of the projects", async () => {
    const { deps, ui } = stubDeps({ codes: [0] });
    await expect(runE2e(e2eArgs("--list"), deps, ui)).resolves.toBe(0);
    expect(deps.capture).not.toHaveBeenCalled();
    expect(deps.run.mock.calls).toEqual([[[...TEST, "--list"]]]);
  });

  it("answers the first failing code and still runs the later projects", async () => {
    const { deps, ui } = stubDeps({ codes: [0, 3, 5] });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(3);
    expect(deps.run).toHaveBeenCalledTimes(3);
  });

  it("installs Chromium first with CI=true", async () => {
    const { deps, ui } = stubDeps({ env: { CI: "true" } });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(0);
    expect(deps.run.mock.calls[0]).toEqual([["playwright", "install", "chromium"]]);
    expect(deps.run).toHaveBeenCalledTimes(4);
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
    expect(deps.run.mock.calls.map(call => call[0][1])).toEqual(["test", "test", "test"]);
  });

  it("answers 1 with the message when the list run fails", async () => {
    const { deps, ui, lines } = stubDeps({ list: { code: 1, stdout: "" } });
    await expect(runE2e(e2eArgs(), deps, ui)).resolves.toBe(1);
    expect(deps.run).not.toHaveBeenCalled();
    expect(lines.join("\n")).toContain(
      "[moku-editor] could not list the projects of tests/pw.config.ts: playwright test --list exited with 1"
    );
  });

  it("answers 1 with the message when the list is not JSON, or the list run throws", async () => {
    const bad = stubDeps({ list: { code: 0, stdout: "Error: no config" } });
    await expect(runE2e(e2eArgs(), bad.deps, bad.ui)).resolves.toBe(1);
    expect(bad.lines.join("\n")).toContain(
      "[moku-editor] could not list the projects of tests/pw.config.ts: "
    );
    const thrown = stubDeps({ list: new Error("spawn bun ENOENT") });
    await expect(runE2e(e2eArgs(), thrown.deps, thrown.ui)).resolves.toBe(1);
    expect(thrown.lines.join("\n")).toContain("spawn bun ENOENT");
    expect(thrown.deps.run).not.toHaveBeenCalled();
  });

  it("runs once as given when the config has no named project", async () => {
    const { deps, ui } = stubDeps({ list: { code: 0, stdout: listOf([""]) }, codes: [2] });
    await expect(runE2e(e2eArgs("--headed"), deps, ui)).resolves.toBe(2);
    expect(deps.run.mock.calls).toEqual([[[...TEST, "--headed"]]]);
  });
});

describe("projectNames", () => {
  it("reads the named projects of a real list output, in config order", () => {
    expect(projectNames(LIST_SAMPLE)).toEqual(["chromium-desktop", "chromium-mobile"]);
  });

  it("answers none for a config without projects", () => {
    expect(projectNames(JSON.stringify({ config: { projects: [] } }))).toEqual([]);
  });

  it.each(["not json", "{}", '{"config":{"projects":"x"}}', "null"])("throws on %j", text => {
    expect(() => projectNames(text)).toThrow(Error);
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

describe("hasProject", () => {
  it("sees --project and --project=, not a word that only starts alike", () => {
    expect(hasProject(["-g", "x", "--project", "a"])).toBe(true);
    expect(hasProject(["--project=a"])).toBe(true);
    expect(hasProject(["--projects", "-g", "--project-x"])).toBe(false);
    expect(hasProject([])).toBe(false);
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
