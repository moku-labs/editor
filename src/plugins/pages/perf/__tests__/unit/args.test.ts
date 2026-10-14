import { describe, expect, it } from "vitest";
import { parseBinArgs } from "../../../args";
import { perfArgs } from "../../args";

/** A two-line error in the spec/11 Part 3 form: the problem, then the fix indented. */
const TWO_LINES = /^\[moku-editor\] [^\n]+\n {2}\S[^\n]*$/;

/**
 * The message of an error result, or a failure.
 *
 * @param words - The words after `perf`.
 * @returns The message.
 */
function errorOf(words: readonly string[]): string {
  const parsed = perfArgs(words);
  if (parsed.kind !== "error") throw new Error(`expected an error, got ${parsed.kind}`);
  return parsed.message;
}

describe("perf argv branch", () => {
  it("parses perf before the serving bin's strict parser, which would refuse --lan", () => {
    const argv = ["perf", "--lan", "-p", "0", "--out", "logs", "--every", "5", "--no-ui"];
    expect(parseBinArgs(argv)).toEqual({
      kind: "perf",
      lan: true,
      port: 0,
      out: "logs",
      every: 5,
      ui: false
    });
  });

  it("uses the defaults: port 47600, logs in .moku/perf, every 10 s, the tools page on", () => {
    expect(perfArgs([])).toEqual({
      kind: "perf",
      lan: false,
      port: 47_600,
      out: ".moku/perf",
      every: 10,
      ui: true
    });
  });

  it("accepts the edges of --port and --every", () => {
    expect(perfArgs(["--port", "65535", "--every", "3600"])).toMatchObject({
      port: 65_535,
      every: 3600
    });
    expect(perfArgs(["-o", "x", "--every", "1"])).toMatchObject({ out: "x", every: 1 });
  });

  it("refuses a port of 65536, an --every of 0 or 3601, an empty --out and a word as port", () => {
    expect(errorOf(["--port", "65536"])).toContain("--port must be an integer 0-65535");
    expect(errorOf(["--port", "http"])).toContain("--port must be an integer 0-65535");
    expect(errorOf(["--every", "0"])).toContain("--every must be an integer 1-3600");
    expect(errorOf(["--every", "3601"])).toContain("--every must be an integer 1-3600");
    expect(errorOf(["--out", ""])).toContain("--out must not be empty");
  });

  it("refuses a positional with the summary hint", () => {
    expect(errorOf(["before.jsonl"])).toBe(
      "[moku-editor] perf takes no file here.\n  Did you mean moku-editor perf summary <log>?"
    );
  });

  it("reads mark with one trimmed label of 1-200 characters", () => {
    expect(perfArgs(["mark", "  boss "])).toEqual({ kind: "perf-mark", label: "boss" });
    expect(perfArgs(["mark", "b".repeat(200)])).toEqual({
      kind: "perf-mark",
      label: "b".repeat(200)
    });
  });

  it("refuses mark with no label, a blank one, two words or 201 characters", () => {
    const message =
      '[moku-editor] perf mark needs one label of 1-200 characters.\n  Run moku-editor perf mark "boss".';
    expect(errorOf(["mark"])).toBe(message);
    expect(errorOf(["mark", "   "])).toBe(message);
    expect(errorOf(["mark", "boss", "fight"])).toBe(message);
    expect(errorOf(["mark", "b".repeat(201)])).toBe(message);
  });

  it("reads summary with exactly one log and compare with exactly two", () => {
    expect(perfArgs(["summary", "a.jsonl"])).toEqual({ kind: "perf-summary", log: "a.jsonl" });
    expect(perfArgs(["compare", "a.jsonl", "b.jsonl"])).toEqual({
      kind: "perf-compare",
      a: "a.jsonl",
      b: "b.jsonl"
    });
    expect(errorOf(["summary"])).toContain("perf summary needs one log file");
    expect(errorOf(["summary", "a.jsonl", "b.jsonl"])).toContain("perf summary needs one log file");
    expect(errorOf(["compare", "a.jsonl"])).toContain("perf compare needs two log files");
    expect(errorOf(["compare", "a", "b", "c"])).toContain("perf compare needs two log files");
  });

  it("answers help for --help or -h anywhere after perf", () => {
    expect(parseBinArgs(["perf", "--help"])).toEqual({ kind: "help" });
    expect(perfArgs(["mark", "-h"])).toEqual({ kind: "help" });
  });

  it("gives every error two lines, the second the fix", () => {
    const cases: readonly (readonly string[])[] = [
      ["--port", "65536"],
      ["--every", "0"],
      ["--out", ""],
      ["--host", "x"],
      ["log.jsonl"],
      ["mark"],
      ["summary"],
      ["compare", "a"]
    ];
    for (const words of cases) expect(errorOf(words)).toMatch(TWO_LINES);
  });
});
