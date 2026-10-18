/* eslint-disable unicorn/no-null -- null is "not read" for the core count */
/**
 * @file connect plugin — CPU per process (spec 11 C6): the pure parsers of `/proc/<pid>/stat` and
 * of `/proc/stat`, the core count, and the share of a process between two ticks — % of all cores
 * and % of one core (top's style).
 */
import type { CpuCounters, ProcStat, ReadingOffReason } from "../types";

/** Fields of /proc/<pid>/stat after the comm, from field 3: utime is field 14, stime 15, start 22. */
const UTIME = 14 - 3;

/** stime's index after the comm. */
const STIME = 15 - 3;

/** starttime's index after the comm. */
const START = 22 - 3;

/** The cpu fields that sum to the total: user, nice, system, idle, iowait, irq, softirq, steal. */
const TOTAL_FIELDS = 8;

/** A `cpuN` line of /proc/stat. */
const CORE_LINE = /^cpu\d+\s/;

/**
 * A number rounded to one decimal.
 *
 * @param value - The number.
 * @returns It, to 0.1.
 * @example
 * ```ts
 * roundTenth(14.25); // 14.3
 * ```
 */
export function roundTenth(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * One `/proc/<pid>/stat` line: the comm is read between the first "(" and the LAST ")", so a
 * process name with spaces or parentheses does not shift the fields.
 *
 * @param line - The line.
 * @returns pid, comm, utime, stime and start time, or undefined for another shape.
 * @example
 * ```ts
 * parseProcStat("4242 (Chrome_InProcGp (x)) S 1 1 0 0 -1 0 0 0 0 0 731 85 0 0 20 0 9 0 52080")?.utime; // 731
 * ```
 */
export function parseProcStat(line: string): ProcStat | undefined {
  const open = line.indexOf("(");
  const close = line.lastIndexOf(")");
  if (open < 1 || close < open) return undefined;

  const fields = line
    .slice(close + 1)
    .trim()
    .split(/\s+/);
  const numbers = [line.slice(0, open), fields[UTIME], fields[STIME], fields[START]].map(Number);
  const [pid = Number.NaN, utime = Number.NaN, stime = Number.NaN, start = Number.NaN] = numbers;
  if (!numbers.every(value => Number.isInteger(value) && value >= 0)) return undefined;
  return { pid, name: line.slice(open + 1, close), utime, stime, start };
}

/**
 * The total jiffies of the `cpu` line of /proc/stat (user to steal; guest is inside user).
 *
 * @param text - /proc/stat, its first line at least.
 * @returns The total, or undefined.
 * @example
 * ```ts
 * parseCpuTotal("cpu  100 20 50 800 10 0 5 3 70 9"); // 988
 * ```
 */
export function parseCpuTotal(text: string): number | undefined {
  const [label, ...fields] = (text.split("\n")[0] ?? "").trim().split(/\s+/);
  if (label !== "cpu" || fields.length < TOTAL_FIELDS) return undefined;
  const values = fields.slice(0, TOTAL_FIELDS).map(Number);
  return values.every(value => Number.isInteger(value) && value >= 0)
    ? values.reduce((sum, value) => sum + value, 0)
    : undefined;
}

/**
 * The cores of a phone: the `cpuN` lines of `head -n 64 /proc/stat`.
 *
 * @param text - The lines.
 * @returns The count, or null when there is none.
 * @example
 * ```ts
 * countCores("cpu  1 2\ncpu0 1 1\ncpu1 0 1\n"); // 2
 * ```
 */
export function countCores(text: string): number | null {
  const cores = text.split("\n").filter(line => CORE_LINE.test(line)).length;
  return cores === 0 ? null : cores;
}

/**
 * The CPU share of a process between two ticks: its `utime + stime` delta over the total delta.
 *
 * @param before - The counters of the tick before (undefined on the first tick).
 * @param after - The counters of this tick.
 * @param pid - The process.
 * @param cores - The phone's cores.
 * @returns % of all cores and % of one core; "warming-up" without a tick before (or for a new
 * pid), "unreadable" without its stat now, "error" when a counter went down (pid reused) or no
 * time passed.
 * @example
 * ```ts
 * cpuShare({ total: 10000, ticks: new Map([[1, 1730]]) }, { total: 10800, ticks: new Map([[1, 1844]]) }, 1, 8); // { pct: 14.3, oneCorePct: 114 }
 * ```
 */
export function cpuShare(
  before: CpuCounters | undefined,
  after: CpuCounters,
  pid: number,
  cores: number
): { readonly pct: number; readonly oneCorePct: number } | ReadingOffReason {
  const now = after.ticks.get(pid);
  if (now === undefined) return "unreadable";
  const then = before?.ticks.get(pid);
  if (before === undefined || then === undefined) return "warming-up";

  const spent = now - then;
  const total = after.total - before.total;
  if (spent < 0 || total <= 0) return "error";
  return {
    pct: roundTenth(Math.min((spent * 100) / total, 100)),
    oneCorePct: roundTenth(Math.min((spent * 100 * cores) / total, 100 * cores))
  };
}
