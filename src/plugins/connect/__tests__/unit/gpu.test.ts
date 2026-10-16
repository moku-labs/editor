/* eslint-disable unicorn/no-null -- null is "the node does not say" in GpuLoad */
import { describe, expect, it } from "vitest";
import { devfreqNodeOf, GPU_NODES, parseGpu, pickGpuNodes } from "../../telemetry/gpu";
import type { GpuNode } from "../../types";
import { parseHeadSections } from "../../wire/parse";
import { fixture, headText } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C6 / § 0.4: GPU clock and busy per vendor, each with its source; a
// format the parser does not know is not available, never a wrong number.
// ─────────────────────────────────────────────────────────────────────────────

/** Every candidate path. */
const CANDIDATES = GPU_NODES.map(node => node.path);

/**
 * The nodes the probe keeps from a head of every candidate.
 *
 * @param text - What head printed.
 * @returns The kept nodes.
 */
function probed(text: string): readonly GpuNode[] {
  return pickGpuNodes(parseHeadSections(text, CANDIDATES));
}

describe("the GPU probe", () => {
  it("keeps only the nodes that answered, of the first vendor, one busy node", () => {
    const mali = probed(fixture("head-tick-1.txt"));
    expect(mali.map(node => node.path)).toEqual([
      "/sys/kernel/gpu/gpu_clock",
      "/sys/kernel/gpu/gpu_busy",
      "/sys/kernel/gpu/gpu_min_clock",
      "/sys/kernel/gpu/gpu_max_clock"
    ]);
    const kgsl = probed(fixture("kgsl-head.txt"));
    expect(kgsl.map(node => node.path)).toEqual([
      "/sys/class/kgsl/kgsl-3d0/gpuclk",
      "/sys/class/kgsl/kgsl-3d0/gpu_busy_percentage",
      "/sys/class/kgsl/kgsl-3d0/min_clock_mhz",
      "/sys/class/kgsl/kgsl-3d0/max_clock_mhz"
    ]);
    expect(probed("")).toEqual([]);
    expect(probed(headText({ "/sys/kernel/gpu/gpu_clock": "fast" }))).toEqual([]);
  });
});

describe("parseGpu", () => {
  it("reads Mali /sys/kernel/gpu: 221 MHz, 63 % busy, 221–949 MHz", () => {
    const nodes = probed(fixture("head-tick-1.txt"));
    const read = parseHeadSections(
      fixture("head-tick-1.txt"),
      nodes.map(node => node.path)
    );
    expect(parseGpu(read, nodes)).toEqual({
      available: true,
      source: "/sys/kernel/gpu",
      value: { mhz: 221, busyPct: 63, minMhz: 221, maxMhz: 949 }
    });
  });

  it("reads kgsl gpuclk in Hz as MHz, and gpubusy 'busy total' as a share", () => {
    const clock = GPU_NODES.find(node => node.path.endsWith("gpuclk"));
    const total = GPU_NODES.find(node => node.path.endsWith("gpubusy"));
    if (clock === undefined || total === undefined) throw new Error("table");
    const read = parseHeadSections(fixture("kgsl-head.txt"), [clock.path, total.path]);
    expect(parseGpu(read, [clock, total])).toEqual({
      available: true,
      source: "/sys/class/kgsl/kgsl-3d0",
      value: { mhz: 585, busyPct: 30, minMhz: null, maxMhz: null }
    });
  });

  it("reads MediaTek GED and devfreq Hz", () => {
    const ged = GPU_NODES.filter(node => node.source === "/sys/kernel/ged/hal");
    const read = parseHeadSections(
      fixture("ged-head.txt"),
      ged.map(node => node.path)
    );
    expect(parseGpu(read, ged)).toMatchObject({ value: { mhz: 836, busyPct: 35 } });

    const devfreq = devfreqNodeOf("1e00000.mali");
    const text = headText({ [devfreq.path]: "221000000" });
    expect(parseGpu(parseHeadSections(text, [devfreq.path]), [devfreq])).toEqual({
      available: true,
      source: "/sys/class/devfreq/1e00000.mali",
      value: { mhz: 221, busyPct: null, minMhz: null, maxMhz: null }
    });
  });

  it("is unknown-format for a clock out of range, never 221000000 MHz", () => {
    // Bug: a Mali node that answers Hz shown as 221000000 MHz.
    const [clock] = probed(fixture("head-tick-1.txt"));
    if (clock === undefined) throw new Error("probe");
    const text = headText({ [clock.path]: "221000000" });
    expect(parseGpu(parseHeadSections(text, [clock.path]), [clock])).toEqual({
      available: false,
      source: "/sys/kernel/gpu",
      reason: "unknown-format"
    });
  });

  it("is not-found without nodes, unreadable for a node gone, no-permission for a denial", () => {
    const [clock] = probed(fixture("head-tick-1.txt"));
    if (clock === undefined) throw new Error("probe");
    expect(parseGpu(parseHeadSections("", []), [])).toEqual({
      available: false,
      source: "none",
      reason: "not-found"
    });
    expect(
      parseGpu(parseHeadSections("==> /proc/stat <==\ncpu 1\n", ["/proc/stat", clock.path]), [
        clock
      ])
    ).toMatchObject({
      available: false,
      reason: "unreadable"
    });
    const denied = `head: ${clock.path}: Permission denied\n`;
    expect(parseGpu(parseHeadSections(denied, [clock.path, "/proc/stat"]), [clock])).toMatchObject({
      available: false,
      reason: "no-permission"
    });
  });
});
