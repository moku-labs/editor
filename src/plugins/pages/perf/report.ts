/**
 * @file pages perf sub-domain — `moku-editor perf summary <log>` and `perf compare <a> <b>`: read
 * finished logs and print the `collector/report` tables. They start nothing. Rows are per screen
 * and rate: a log at 120 fps is never compared with one at 60.
 */
import { basename } from "node:path/posix";
import type { BrandConsole } from "@moku-labs/common/cli";
import type { CompareRow, ParsedLog } from "../../collector/report";
import {
  compare,
  compareText,
  isPerfLog,
  parsePerfLog,
  summarize,
  summaryText
} from "../../collector/report";
import type { PerfCompareArgs, PerfDeps, PerfSummaryArgs } from "./types";

/**
 * Reads and parses a log; prints why when it cannot.
 *
 * @param log - The path as given.
 * @param command - "perf summary" or "perf compare", for the message.
 * @param deps - The process seam (readText).
 * @param ui - The brand console.
 * @returns The parsed log, or undefined after printing the error.
 */
async function readLog(
  log: string,
  command: string,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<ParsedLog | undefined> {
  let text: string;
  try {
    text = await deps.readText(log);
  } catch {
    ui.error(
      `[moku-editor] ${command}: ${log} does not exist.\n  Give the path of a .jsonl log, for example .moku/perf/<log>.jsonl.`
    );
    return undefined;
  }

  const parsed = parsePerfLog(text);
  if (isPerfLog(parsed)) return parsed;

  ui.error(
    `[moku-editor] ${log} is not a moku perf log (v1).\n  Pass a log written by moku-editor perf or the overlay.`
  );
  return undefined;
}

/**
 * The name of a compared row: its screen and rate.
 *
 * @param row - The row's screen and rate.
 * @param row.path - The screen.
 * @param row.rate - The rate, or null.
 * @returns The screen, then the rate after an at sign when it is known.
 * @example
 * ```ts
 * rowName({ path: "settings", rate: 120 }); // "settings @120"
 * ```
 */
function rowName(row: Pick<CompareRow, "path" | "rate">): string {
  return row.rate === null ? row.path : `${row.path} @${row.rate}`;
}

/**
 * Prints the summary table of a finished log.
 *
 * @param args - The log path.
 * @param deps - The process seam (readText).
 * @param ui - The brand console.
 * @returns 0 after the table; 1 for a missing file or a file that is not a v1 perf log.
 * @example
 * ```ts
 * await perfSummary({ kind: "perf-summary", log: ".moku/perf/perf-20261014-1532-sm-a266b.jsonl" }, processPerfDeps(), ui); // 0
 * ```
 */
export async function perfSummary(
  args: PerfSummaryArgs,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<number> {
  const parsed = await readLog(args.log, "perf summary", deps, ui);
  if (parsed === undefined) return 1;

  for (const line of summaryText(summarize(parsed))) ui.line(line);
  return 0;
}

/**
 * Prints the comparison of two finished logs by screen and rate, then one warning that counts the
 * screens that got worse by 10 % or more. The exit code stays 0 when screens got worse.
 *
 * @param args - The two log paths.
 * @param deps - The process seam (readText).
 * @param ui - The brand console.
 * @returns 0 after the table; 1 when either file is missing or not a v1 perf log.
 * @example
 * ```ts
 * await perfCompare({ kind: "perf-compare", a: "before.jsonl", b: "after.jsonl" }, processPerfDeps(), ui);
 * // 0; "Compare A before.jsonl → B after.jsonl", the rows, "⚠ 1 screen got worse by 10 % or more: garden/boss @60"
 * ```
 */
export async function perfCompare(
  args: PerfCompareArgs,
  deps: PerfDeps,
  ui: BrandConsole
): Promise<number> {
  const a = await readLog(args.a, "perf compare", deps, ui);
  if (a === undefined) return 1;
  const b = await readLog(args.b, "perf compare", deps, ui);
  if (b === undefined) return 1;

  const comparison = compare(summarize(a), summarize(b));
  const names = { a: basename(args.a), b: basename(args.b) };
  for (const line of compareText(comparison, names)) ui.line(line);

  const worse = comparison.rows.filter(row => row.worse.length > 0);
  if (worse.length > 0) {
    const screens = worse.length === 1 ? "1 screen" : `${worse.length} screens`;
    ui.warn(`${screens} got worse by 10 % or more: ${worse.map(row => rowName(row)).join(", ")}`);
  }
  return 0;
}
