/**
 * @file renderView series — spike groups (spec 09 § M8 item 7, § M11): consecutive frames of one
 * primary cause form one group; a frame of another cause, a calm frame or a missing frame ends it.
 * One flag and one inspector row per group; a click on any of its frames selects them all.
 */
import type { PerfCause, PerfHistory } from "../source/contract";
import { causeName, spikeCause } from "../source/contract";
import type { SpikeGroup } from "./types";

/**
 * The primary cause code of a row (spikeCause): 0 for a frame that is not a spike.
 *
 * @param history - The history.
 * @param row - The row.
 * @returns The code.
 * @example
 * ```ts
 * spikeCodeAt(history, 365); // 3: a compile
 * ```
 */
export function spikeCodeAt(history: PerfHistory, row: number): number {
  return spikeCause(history.causes[row] ?? 0, history.rest[row] ?? 0);
}

/**
 * Whether row `next` continues the group of row `row`: the next frame number, the same cause.
 *
 * @param history - The history.
 * @param row - A row of the group.
 * @param next - The row beside it.
 * @param code - The group's cause code.
 * @returns Whether it belongs to the group.
 */
function continues(history: PerfHistory, row: number, next: number, code: number): boolean {
  if (next < 0 || next >= history.count) return false;
  const step = (history.frame[next] ?? 0) - (history.frame[row] ?? 0);
  return Math.abs(step) === 1 && spikeCodeAt(history, next) === code;
}

/**
 * The group of rows `first`..`last` of one cause.
 *
 * @param history - The history.
 * @param first - Its first row.
 * @param last - Its last row.
 * @param cause - Its cause.
 * @returns The group.
 */
function groupOf(history: PerfHistory, first: number, last: number, cause: PerfCause): SpikeGroup {
  let maxMs = 0;
  for (let row = first; row <= last; row += 1) maxMs = Math.max(maxMs, history.ms[row] ?? 0);
  return {
    from: history.frame[first] ?? 0,
    to: history.frame[last] ?? 0,
    cause,
    maxMs: Math.round(maxMs * 100) / 100,
    firstRow: first,
    lastRow: last
  };
}

/**
 * The spike group a row belongs to: the row and its neighbours of the same cause.
 *
 * @param history - The history.
 * @param row - A row.
 * @returns The group; undefined when the row is not a spike.
 * @example
 * ```ts
 * spikeGroupAt(history, 366); // { from: 4851, to: 4853, cause: "compile", maxMs: 41.3, firstRow: 365, lastRow: 367 }
 * ```
 */
export function spikeGroupAt(history: PerfHistory, row: number): SpikeGroup | undefined {
  const code = spikeCodeAt(history, row);
  const cause = causeName(code);
  if (cause === undefined) return undefined;
  let first = row;
  let last = row;
  while (continues(history, first, first - 1, code)) first -= 1;
  while (continues(history, last, last + 1, code)) last += 1;
  return groupOf(history, first, last, cause);
}

/**
 * The spike groups that touch rows `first`..`last`, oldest first.
 *
 * @param history - The history.
 * @param first - The first row.
 * @param last - The last row (inclusive).
 * @returns The groups (allocates: for the header and the inspector, never a paint).
 * @example
 * ```ts
 * spikeGroups(history, 0, history.count - 1).length; // 3: f4802, f4851–4853, f4890
 * ```
 */
export function spikeGroups(history: PerfHistory, first: number, last: number): SpikeGroup[] {
  const groups: SpikeGroup[] = [];
  let row = Math.max(0, first);
  const end = Math.min(last, history.count - 1);
  while (row <= end) {
    const group = spikeGroupAt(history, row);
    if (group === undefined) {
      row += 1;
      continue;
    }
    groups.push(group);
    row = group.lastRow + 1;
  }
  return groups;
}
