import { readFile } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { perfCompare, perfSummary } from "../../report";
import { perfDeps, perfLogText, recordingConsole, removeRoot, tempRoot, writeIn } from "../helpers";

let root: string;

beforeEach(async () => {
  root = await tempRoot();
});

afterEach(async () => {
  await removeRoot(root);
});

/** Deps whose readText reads the real files. */
const READING = perfDeps({ readText: path => readFile(path, "utf8") });

describe("perfSummary", () => {
  it("prints the summary table of a finished log", async () => {
    const log = await writeIn(root, "a.jsonl", perfLogText());
    const { ui, lines } = recordingConsole();
    expect(await perfSummary({ kind: "perf-summary", log }, READING, ui)).toBe(0);
    expect(lines[0]).toMatch(/^SM-A266B · webgpu · engine 0\.14\.12\+9c41e0/);
    expect(lines.some(line => line.includes("garden/boss"))).toBe(true);
  });

  it("refuses a game log without v: 1 with 1", async () => {
    const log = await writeIn(root, "game.jsonl", '{"kind":"sample","t":1}\n{"level":"info"}\n');
    const { ui, lines } = recordingConsole();
    expect(await perfSummary({ kind: "perf-summary", log }, READING, ui)).toBe(1);
    expect(lines).toEqual([
      `  ✗ [moku-editor] ${log} is not a moku perf log (v1).\n  Pass a log written by moku-editor perf or the overlay.`
    ]);
  });

  it("answers 1 for a file that does not exist", async () => {
    const { ui, lines } = recordingConsole();
    const log = `${root}/none.jsonl`;
    expect(await perfSummary({ kind: "perf-summary", log }, READING, ui)).toBe(1);
    expect(lines).toEqual([
      `  ✗ [moku-editor] perf summary: ${log} does not exist.\n  Give the path of a .jsonl log, for example .moku/perf/<log>.jsonl.`
    ]);
  });
});

describe("perfCompare", () => {
  it("prints the rows and warns about the screens that got worse, and only those", async () => {
    const a = await writeIn(
      root,
      "before.jsonl",
      perfLogText([
        { path: "garden/boss", bucket: 8 },
        { path: "settings", bucket: 8 }
      ])
    );
    const b = await writeIn(
      root,
      "after.jsonl",
      perfLogText([
        { path: "garden/boss", bucket: 30 },
        { path: "settings", bucket: 8 }
      ])
    );
    const { ui, lines } = recordingConsole();
    expect(await perfCompare({ kind: "perf-compare", a, b }, READING, ui)).toBe(0);
    expect(lines[0]).toBe("Compare A before.jsonl → B after.jsonl");
    expect(lines.some(line => line.includes("settings"))).toBe(true);
    expect(lines.at(-1)).toBe("  ⚠ 1 screen got worse by 10 % or more: garden/boss @120");
  });

  it("prints no warning when no screen got worse", async () => {
    const a = await writeIn(root, "a.jsonl", perfLogText());
    const { ui, lines } = recordingConsole();
    expect(await perfCompare({ kind: "perf-compare", a, b: a }, READING, ui)).toBe(0);
    expect(lines.some(line => line.includes("⚠"))).toBe(false);
  });

  it("answers 1 when either log is missing or not a perf log", async () => {
    const a = await writeIn(root, "a.jsonl", perfLogText());
    const { ui, lines } = recordingConsole();
    const b = `${root}/gone.jsonl`;
    expect(await perfCompare({ kind: "perf-compare", a, b }, READING, ui)).toBe(1);
    expect(lines).toEqual([
      `  ✗ [moku-editor] perf compare: ${b} does not exist.\n  Give the path of a .jsonl log, for example .moku/perf/<log>.jsonl.`
    ]);
    const game = await writeIn(root, "game.jsonl", "{}\n");
    expect(await perfCompare({ kind: "perf-compare", a: game, b: a }, READING, ui)).toBe(1);
  });
});

describe("report hardening (W3, I7)", () => {
  it("cleans a screen path before it names it in the closing warning", async () => {
    const path = "garden\u001B[2J\u202E/boss";
    const a = await writeIn(root, "a.jsonl", perfLogText([{ path, bucket: 8 }]));
    const b = await writeIn(root, "b.jsonl", perfLogText([{ path, bucket: 30 }]));
    const { ui, lines } = recordingConsole();
    expect(await perfCompare({ kind: "perf-compare", a, b }, READING, ui)).toBe(0);
    expect(lines.at(-1)).toBe("  ⚠ 1 screen got worse by 10 % or more: garden[2J/boss @120");
  });

  it("says does not exist only for a missing file, else prints the read error with the same fix", async () => {
    const { ui, lines } = recordingConsole();
    expect(await perfSummary({ kind: "perf-summary", log: root }, READING, ui)).toBe(1);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(
      /^ {2}✗ \[moku-editor\] perf summary: [^\n]*EISDIR[^\n]*\n {2}Give the path of a \.jsonl log, for example \.moku\/perf\/<log>\.jsonl\.$/
    );
    expect(lines[0]).not.toContain("does not exist");
  });
});
