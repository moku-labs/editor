/**
 * @file pages perf sub-domain — the words after `moku-editor perf`: `mark "<label>"`,
 * `summary <log>`, `compare <a> <b>`, or the run's switches `[--lan] [--port 47600] [--out DIR]
 * [--every 10] [--no-ui]` (strict). Pure: no I/O. Every error is two lines, the second the fix.
 */
import { parseArgs } from "node:util";
import type { BinArgs } from "../types";

/** The device port when `--port` is not given. */
const DEFAULT_PORT = 47_600;

/** The highest TCP port. */
const PORT_MAX = 65_535;

/** Seconds between two adb readings when `--every` is not given. */
const DEFAULT_EVERY = 10;

/** The longest `--every`, in seconds. */
const EVERY_MAX = 3600;

/** The log folder when `--out` is not given. */
const DEFAULT_OUT = ".moku/perf";

/** The longest mark label, after trimming (the collector's limit). */
const LABEL_MAX = 200;

/** Why `perf mark` is refused. */
const MARK_ERROR =
  'perf mark needs one label of 1-200 characters.\n  Run moku-editor perf mark "boss".';

/** Why `perf summary` is refused. */
const SUMMARY_ERROR =
  "perf summary needs one log file.\n  Run moku-editor perf summary .moku/perf/<log>.jsonl.";

/** Why `perf compare` is refused. */
const COMPARE_ERROR =
  "perf compare needs two log files.\n  Run moku-editor perf compare a.jsonl b.jsonl.";

/** Why a positional of the run is refused. */
const NO_FILE_ERROR = "perf takes no file here.\n  Did you mean moku-editor perf summary <log>?";

/** Why a `--port` is refused. */
const PORT_ERROR = "perf --port must be an integer 0-65535.\n  Run moku-editor perf --port 47600.";

/** Why an `--every` is refused. */
const EVERY_ERROR =
  "perf --every must be an integer 1-3600 (seconds).\n  Run moku-editor perf --every 10.";

/** Why an `--out` is refused. */
const OUT_ERROR = "perf --out must not be empty.\n  Run moku-editor perf --out .moku/perf.";

/**
 * An error result with the editor prefix.
 *
 * @param message - The two-line message.
 * @returns The error result.
 * @example
 * ```ts
 * failed(OUT_ERROR).kind; // "error"
 * ```
 */
function failed(message: string): BinArgs {
  return { kind: "error", message: `[moku-editor] ${message}` };
}

/**
 * Parses the run's switches strictly; positionals are kept so the caller can refuse them.
 *
 * @param words - The words after `perf`.
 * @returns The positionals and flag values.
 * @throws {Error} On an unknown flag or a flag without its value.
 * @example
 * ```ts
 * parse(["--lan", "-p", "0"]).values.port; // "0"
 * ```
 */
function parse(words: readonly string[]) {
  return parseArgs({
    args: [...words],
    allowPositionals: true,
    strict: true,
    options: {
      lan: { type: "boolean" },
      port: { type: "string", short: "p" },
      out: { type: "string", short: "o" },
      every: { type: "string" },
      "no-ui": { type: "boolean" }
    }
  });
}

/**
 * A whole number written in digits within a range.
 *
 * @param value - The flag value.
 * @param min - The least accepted number.
 * @param max - The greatest accepted number.
 * @returns The number, or undefined.
 * @example
 * ```ts
 * integerIn("3601", 1, 3600); // undefined
 * ```
 */
function integerIn(value: string, min: number, max: number): number | undefined {
  if (!/^\d{1,5}$/.test(value)) return undefined;

  const number = Number(value);
  return number >= min && number <= max ? number : undefined;
}

/**
 * `perf mark <label>`: exactly one word, 1-200 characters after trimming.
 *
 * @param words - The words after `mark`.
 * @returns The mark arguments, or the error.
 * @example
 * ```ts
 * markArgs(["  boss "]); // { kind: "perf-mark", label: "boss" }
 * ```
 */
function markArgs(words: readonly string[]): BinArgs {
  const label = words.length === 1 ? words[0]?.trim() : undefined;
  const fits = label !== undefined && label.length > 0 && label.length <= LABEL_MAX;
  return fits ? { kind: "perf-mark", label } : failed(MARK_ERROR);
}

/**
 * The run's switches: the defaults, the ranges, no positional.
 *
 * @param words - The words after `perf`.
 * @returns The run arguments, or the error.
 * @example
 * ```ts
 * runArgs(["--no-ui"]); // { kind: "perf", lan: false, port: 47600, out: ".moku/perf", every: 10, ui: false }
 * ```
 */
function runArgs(words: readonly string[]): BinArgs {
  let parsed: ReturnType<typeof parse>;
  try {
    parsed = parse(words);
  } catch (error) {
    const reason = (error instanceof Error ? error.message : String(error)).replaceAll("\n", " ");
    return failed(`perf: ${reason}\n  Run moku-editor perf --help for its switches.`);
  }

  const { positionals, values } = parsed;
  if (positionals.length > 0) return failed(NO_FILE_ERROR);

  const port = values.port === undefined ? DEFAULT_PORT : integerIn(values.port, 0, PORT_MAX);
  if (port === undefined) return failed(PORT_ERROR);

  const every = values.every === undefined ? DEFAULT_EVERY : integerIn(values.every, 1, EVERY_MAX);
  if (every === undefined) return failed(EVERY_ERROR);

  const out = values.out ?? DEFAULT_OUT;
  if (out === "") return failed(OUT_ERROR);

  return { kind: "perf", lan: values.lan === true, port, out, every, ui: values["no-ui"] !== true };
}

/**
 * Parses the words after `moku-editor perf`: help anywhere, then `mark`, `summary`, `compare`,
 * else the run's switches.
 *
 * @param words - The words after `perf`.
 * @returns `perf`, `perf-mark`, `perf-summary`, `perf-compare`, `help`, or a two-line `error`.
 * @example
 * ```ts
 * perfArgs(["--lan", "-p", "0"]); // { kind: "perf", lan: true, port: 0, out: ".moku/perf", every: 10, ui: true }
 * perfArgs(["mark", "boss"]); // { kind: "perf-mark", label: "boss" }
 * perfArgs(["compare", "a.jsonl", "b.jsonl"]); // { kind: "perf-compare", a: "a.jsonl", b: "b.jsonl" }
 * ```
 */
export function perfArgs(words: readonly string[]): BinArgs {
  if (words.includes("--help") || words.includes("-h")) return { kind: "help" };

  const [command, ...rest] = words;
  if (command === "mark") return markArgs(rest);
  if (command === "summary") {
    const [log] = rest;
    return rest.length === 1 && log ? { kind: "perf-summary", log } : failed(SUMMARY_ERROR);
  }
  if (command === "compare") {
    const [a, b] = rest;
    return rest.length === 2 && a && b ? { kind: "perf-compare", a, b } : failed(COMPARE_ERROR);
  }
  return runArgs(words);
}
