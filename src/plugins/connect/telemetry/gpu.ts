/* eslint-disable unicorn/no-null -- null is "the node does not say" in GpuLoad */
/**
 * @file connect plugin — GPU clock and busy of a wired phone (spec 11 § 0.4, C6): the table of the
 * sysfs nodes per vendor (data), the probe's pick of the nodes that answered, and the pure parse of
 * one tick. A value outside its range is "unknown-format", never a wrong number: a Mali node that
 * answers Hz is not shown as 221000000 MHz.
 */
import type { GpuLoad, GpuNode, HeadRead, Reading, ReadingOffReason } from "../types";
import { roundTenth } from "./cpu";

/** Samsung's Mali kernel nodes. */
const MALI = "/sys/kernel/gpu";

/** Qualcomm Adreno (kgsl). */
const KGSL = "/sys/class/kgsl/kgsl-3d0";

/** MediaTek GED. */
const GED = "/sys/kernel/ged/hal";

/**
 * The candidate GPU nodes, in the order the probe prefers them (11 ≤ the 12 paths of one head).
 * The first vendor with a node that answers wins.
 */
export const GPU_NODES: readonly GpuNode[] = [
  { path: `${MALI}/gpu_clock`, source: MALI, reads: "clock", format: "mhz" },
  { path: `${MALI}/gpu_busy`, source: MALI, reads: "busy", format: "percent" },
  { path: `${MALI}/gpu_min_clock`, source: MALI, reads: "min", format: "mhz" },
  { path: `${MALI}/gpu_max_clock`, source: MALI, reads: "max", format: "mhz" },
  { path: `${KGSL}/gpuclk`, source: KGSL, reads: "clock", format: "hz" },
  { path: `${KGSL}/gpu_busy_percentage`, source: KGSL, reads: "busy", format: "percent" },
  { path: `${KGSL}/gpubusy`, source: KGSL, reads: "busy", format: "busy-total" },
  { path: `${KGSL}/min_clock_mhz`, source: KGSL, reads: "min", format: "mhz" },
  { path: `${KGSL}/max_clock_mhz`, source: KGSL, reads: "max", format: "mhz" },
  { path: `${GED}/current_freqency`, source: GED, reads: "clock", format: "khz-pair" },
  { path: `${GED}/gpu_utilization`, source: GED, reads: "busy", format: "utilization" }
];

/** The field of GpuLoad each kind of node fills. */
const FIELDS: Readonly<Record<GpuNode["reads"], keyof GpuLoad>> = {
  clock: "mhz",
  busy: "busyPct",
  min: "minMhz",
  max: "maxMhz"
};

/** The fastest GPU clock believed, MHz. */
const MAX_MHZ = 5000;

/** A devfreq device that is a GPU. */
const GPU_DEVFREQ = /mali|gpu|kgsl/i;

/** A devfreq name the allowlist accepts. */
const DEVFREQ_NAME = /^[\w.-]{1,64}$/;

/**
 * A clock in MHz when it is believable.
 *
 * @param value - MHz.
 * @returns Whole MHz 1–5000, or undefined.
 * @example
 * ```ts
 * mhzOf(221000000); // undefined
 * ```
 */
function mhzOf(value: number | undefined): number | undefined {
  return value !== undefined && value >= 1 && value <= MAX_MHZ ? Math.round(value) : undefined;
}

/**
 * A share in % when it is one.
 *
 * @param value - %.
 * @returns % 0–100 to 0.1, or undefined.
 * @example
 * ```ts
 * pctOf(63); // 63
 * ```
 */
function pctOf(value: number | undefined): number | undefined {
  return value !== undefined && value >= 0 && value <= 100 ? roundTenth(value) : undefined;
}

/**
 * The share of a kgsl `gpubusy` line, "busy total".
 *
 * @param busy - Busy cycles.
 * @param total - All cycles.
 * @returns %, 0 for an idle window, undefined for another shape.
 * @example
 * ```ts
 * busyShare(120, 400); // 30
 * ```
 */
function busyShare(busy: number | undefined, total: number | undefined): number | undefined {
  if (busy === undefined || total === undefined || busy > total) return undefined;
  return total === 0 ? 0 : pctOf((busy * 100) / total);
}

/**
 * The value of one node's first line in its format: MHz for a clock, % for busy.
 *
 * @param node - The node.
 * @param text - What head read of it.
 * @returns The value, or undefined for a format the parser does not know.
 * @example
 * ```ts
 * gpuValueOf({ path: "/sys/class/kgsl/kgsl-3d0/gpuclk", source: "/sys/class/kgsl/kgsl-3d0", reads: "clock", format: "hz" }, "585000000"); // 585
 * ```
 */
export function gpuValueOf(node: GpuNode, text: string): number | undefined {
  const line = (text.split("\n")[0] ?? "").replace("%", " ").trim();
  const numbers = line.split(/\s+/).map(Number);
  if (line === "" || !numbers.every(value => Number.isFinite(value))) return undefined;

  switch (node.format) {
    case "mhz": {
      return mhzOf(numbers[0]);
    }
    case "hz": {
      return mhzOf((numbers[0] ?? 0) / 1_000_000);
    }
    case "khz-pair": {
      return mhzOf((numbers.at(-1) ?? 0) / 1000);
    }
    case "busy-total": {
      return busyShare(numbers[0], numbers[1]);
    }
    default: {
      return pctOf(numbers[0]);
    }
  }
}

/**
 * The probe's pick: of a head over every candidate, the nodes that answered with a value, of the
 * first vendor that has one, one node per kind (kgsl's `gpu_busy_percentage` before `gpubusy`).
 *
 * @param read - The head over GPU_NODES (or a devfreq clock).
 * @param candidates - The nodes asked, in preference order.
 * @returns The nodes the ticks read; [] when none answered.
 * @example
 * ```ts
 * pickGpuNodes({ sections: new Map([["/sys/kernel/gpu/gpu_clock", "221"]]), denied: new Set() }).map(node => node.path); // ["/sys/kernel/gpu/gpu_clock"]
 * ```
 */
export function pickGpuNodes(
  read: HeadRead,
  candidates: readonly GpuNode[] = GPU_NODES
): GpuNode[] {
  const answered = candidates.filter(node => {
    const text = read.sections.get(node.path);
    return text !== undefined && gpuValueOf(node, text) !== undefined;
  });
  const source = answered[0]?.source;
  const kinds = new Set<GpuNode["reads"]>();
  return answered.filter(node => {
    if (node.source !== source || kinds.has(node.reads)) return false;
    kinds.add(node.reads);
    return true;
  });
}

/**
 * The node of a devfreq device's clock (Hz).
 *
 * @param name - The devfreq name, e.g. "1e00000.mali".
 * @returns The node.
 * @example
 * ```ts
 * devfreqNodeOf("1e00000.mali").path; // "/sys/class/devfreq/1e00000.mali/cur_freq"
 * ```
 */
export function devfreqNodeOf(name: string): GpuNode {
  const source = `/sys/class/devfreq/${name}`;
  return { path: `${source}/cur_freq`, source, reads: "clock", format: "hz" };
}

/**
 * The devfreq devices of `ls /sys/class/devfreq` that are GPUs.
 *
 * @param text - What ls printed.
 * @returns Their names.
 * @example
 * ```ts
 * gpuDevfreqNames("17000010.devfreq_mif\n1e00000.mali\n"); // ["1e00000.mali"]
 * ```
 */
export function gpuDevfreqNames(text: string): string[] {
  return text.split(/\s+/).filter(name => DEVFREQ_NAME.test(name) && GPU_DEVFREQ.test(name));
}

/**
 * The GPU reading of one tick from the probed nodes. One node failing leaves the others; with no
 * value at all the reading is not available: no node probed → "not-found"; a section missing →
 * "unreadable" ("no-permission" when head said so); a value out of its format → "unknown-format".
 *
 * @param read - The tick's head.
 * @param nodes - The probed nodes.
 * @returns The reading, its source the nodes' folder.
 * @example
 * ```ts
 * parseGpu({ sections: new Map([["/sys/kernel/gpu/gpu_clock", "221"]]), denied: new Set() }, [{ path: "/sys/kernel/gpu/gpu_clock", source: "/sys/kernel/gpu", reads: "clock", format: "mhz" }]); // { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: null, minMhz: null, maxMhz: null } }
 * ```
 */
export function parseGpu(read: HeadRead, nodes: readonly GpuNode[]): Reading<GpuLoad> {
  const source = nodes[0]?.source;
  if (source === undefined) return { available: false, source: "none", reason: "not-found" };

  const load: { -readonly [K in keyof GpuLoad]: GpuLoad[K] } = {
    mhz: null,
    busyPct: null,
    minMhz: null,
    maxMhz: null
  };
  let found = false;
  let reason: ReadingOffReason | undefined;
  for (const node of nodes) {
    const text = read.sections.get(node.path);
    const value = text === undefined ? undefined : gpuValueOf(node, text);
    if (value !== undefined) {
      load[FIELDS[node.reads]] = value;
      found = true;
    } else if (text === undefined) {
      reason ??= read.denied.has(node.path) ? "no-permission" : "unreadable";
    } else reason = "unknown-format";
  }
  return found
    ? { available: true, source, value: load }
    : { available: false, source, reason: reason ?? "unreadable" };
}
