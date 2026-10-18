/* eslint-disable unicorn/no-null -- null is "row absent" in ProcessMemory */
/**
 * @file connect plugin — memory per process (spec 11 C6): the pure parser of `dumpsys meminfo
 * <pid>`. The "App Summary" rows (KB) become MB; `GL mtrack` comes from the table. A whole-process
 * number, never the JS heap. A row the output does not have is null, never 0.
 */
import type { ProcessMemory, ReadingOffReason } from "../types";
import { roundTenth } from "./cpu";

/** KB in a MB (dumpsys prints KiB). */
const KB_PER_MB = 1024;

/**
 * The first number after a label at the start of a line.
 *
 * @param text - The text.
 * @param label - The label, e.g. "Java Heap:".
 * @returns KB, or undefined.
 * @example
 * ```ts
 * kbAfter("           Java Heap:    18636      36432\n", "Java Heap:"); // 18636
 * ```
 */
function kbAfter(text: string, label: string): number | undefined {
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith(label)) continue;
    const first = trimmed.slice(label.length).trim().split(/\s+/)[0] ?? "";
    return /^\d+$/.test(first) ? Number(first) : undefined;
  }
  return undefined;
}

/**
 * KB as MB, to 0.1; undefined stays null.
 *
 * @param kb - KB.
 * @returns MB or null.
 * @example
 * ```ts
 * mbOf(553984); // 541
 * ```
 */
function mbOf(kb: number | undefined): number | null {
  return kb === undefined ? null : roundTenth(kb / KB_PER_MB);
}

/**
 * The memory of one process from `dumpsys meminfo <pid>`.
 *
 * @param text - What dumpsys printed.
 * @param pid - The process.
 * @param at - Epoch ms of the reading.
 * @returns The memory in MB; "not-found" when the process is gone, "unknown-format" without a
 * TOTAL PSS.
 * @example
 * ```ts
 * parseMeminfo(" App Summary\n         Native Heap:    10240\n           TOTAL PSS:    20480\n", 23811, 1791986080000); // { pid: 23811, totalPssMb: 20, nativeMb: 10, javaMb: null, … }
 * ```
 */
export function parseMeminfo(
  text: string,
  pid: number,
  at: number
): ProcessMemory | ReadingOffReason {
  if (text.includes("No process found")) return "not-found";
  const summary = text.split("App Summary")[1];
  const total =
    summary === undefined
      ? undefined
      : (kbAfter(summary, "TOTAL PSS:") ?? kbAfter(summary, "TOTAL:"));
  if (summary === undefined || total === undefined) return "unknown-format";

  const mb = (label: string): number | null => mbOf(kbAfter(summary, label));
  const gl = kbAfter(text, "GL mtrack");
  return {
    pid,
    totalPssMb: roundTenth(total / KB_PER_MB),
    javaMb: mb("Java Heap:"),
    nativeMb: mb("Native Heap:"),
    graphicsMb: mb("Graphics:"),
    glMb: mbOf(gl),
    codeMb: mb("Code:"),
    stackMb: mb("Stack:"),
    otherMb: mb("Private Other:"),
    systemMb: mb("System:"),
    at
  };
}
