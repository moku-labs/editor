/* eslint-disable unicorn/no-null -- null is "not measured" on the wire */
import { describe, expect, it } from "vitest";
import type { PerfHeaderLine } from "../../protocol";
import { chainsOf, gpuShare, isTilerGpu } from "../../protocol";
import type { WirePass } from "../wire-fixtures";
import { passRowsOf } from "../wire-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/passes (spec 03 Delta 2026-10-16 D5): filter chains over a second,
// the GPU share of a pass and the tile-GPU test.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A filter pass of a frame row.
 *
 * @param row - The frame row.
 * @param index - The pass index.
 * @param fields - The rest.
 * @returns The pass.
 */
function filter(row: number, index: number, fields: Partial<WirePass> = {}): WirePass {
  return { row, index, kind: "filter", w: 540, h: 1170, ...fields };
}

/**
 * A GPU of a header.
 *
 * @param fields - vendor, architecture and renderer.
 * @returns The gpu.
 */
function gpuOf(fields: Partial<PerfHeaderLine["gpu"]>): PerfHeaderLine["gpu"] {
  return {
    backend: "webgpu",
    vendor: null,
    architecture: null,
    renderer: null,
    timer: "timestamp-query",
    ...fields
  };
}

describe("chainsOf", () => {
  it("joins consecutive filter passes of one owner into one chain and starts another for the next owner (bug: one chain per pass, or two owners merged)", () => {
    const rows = passRowsOf([
      { row: 0, index: 0, kind: "canvas", view: "main" },
      filter(0, 1, { owner: 412, view: "fogLayer", filter: "fog.blur" }),
      filter(0, 2, { owner: 412, view: "fogLayer", filter: "fog.blur" }),
      filter(0, 3, { owner: 412, view: "fogLayer", filter: "colorMatrix" }),
      filter(0, 4, { owner: 77, view: "glowLayer", filter: "glow" })
    ]);
    expect(chainsOf(rows).map(chain => [chain.owner, chain.view, chain.kinds])).toEqual([
      [412, "fogLayer", ["fog.blur", "fog.blur", "colorMatrix"]],
      [77, "glowLayer", ["glow"]]
    ]);
  });

  it("keys chains by view without owners, names an unnamed filter 'filter', and breaks at a canvas pass (bug: a 0.15.0 engine's filters merged into one chain)", () => {
    const rows = passRowsOf([
      filter(0, 0, { view: "fog" }),
      filter(0, 1, { view: "fog" }),
      filter(0, 2, { view: "glow" }),
      { row: 0, index: 3, kind: "canvas", view: "main" },
      filter(0, 4, { view: "glow" })
    ]);
    expect(
      chainsOf(rows).map(chain => [chain.owner, chain.view, chain.kinds, chain.applies])
    ).toEqual([
      [null, "fog", ["filter", "filter"], 2],
      [null, "glow", ["filter"], 2]
    ]);
  });

  it("sums a chain over the frames of the second: applies, megapixels, draws per frame, p50 and max GPU per frame, mean share (bug: a second's chain read from one frame, or the p50 of passes instead of frames)", () => {
    const passes: WirePass[] = [];
    for (const [row, chainMs] of [2, 3, 7].entries()) {
      passes.push(
        { row, index: 0, kind: "canvas", view: "main", gpuMs: 2, draws: 40 },
        filter(row, 1, {
          owner: 412,
          view: "fogLayer",
          filter: "fog.blur",
          gpuMs: chainMs - 1,
          draws: 2
        }),
        filter(row, 2, { owner: 412, view: "fogLayer", filter: "colorMatrix", gpuMs: 1, draws: 2 })
      );
    }
    expect(chainsOf(passRowsOf(passes))).toEqual([
      {
        owner: 412,
        view: "fogLayer",
        kinds: ["fog.blur", "colorMatrix"],
        applies: 6,
        mpx: 3.8,
        draws: 4,
        gpuMs: { p50: 3, max: 7 },
        share: 0.65
      }
    ]);
  });

  it("answers null GPU, share and draws without a GPU timer or a draw count (bug: shares from NaN, '0 draws' on WebGL)", () => {
    const rows = passRowsOf([
      { row: 0, index: 0, kind: "canvas", view: "main" },
      filter(0, 1, { owner: 412, view: "fogLayer", filter: "fog.blur" })
    ]);
    expect(chainsOf(rows)[0]).toMatchObject({ applies: 1, draws: null, gpuMs: null, share: null });
  });

  it("lists the heaviest chain first (bug: the passes panel leading with a light chain)", () => {
    const rows = passRowsOf([
      filter(0, 0, { owner: 1, view: "light", gpuMs: 0.5 }),
      { row: 0, index: 1, kind: "canvas", view: "main", gpuMs: 1 },
      filter(0, 2, { owner: 2, view: "heavy", gpuMs: 4 })
    ]);
    expect(chainsOf(rows).map(chain => chain.view)).toEqual(["heavy", "light"]);
  });
});

describe("isTilerGpu", () => {
  it("is true for an ARM, Mali, Adreno, Apple or PowerVR GPU, false for NVIDIA, a word inside another and none (bug: a desktop GPU ranked as a tiler, or a Mali ranked by decimals)", () => {
    expect(isTilerGpu(gpuOf({ vendor: "arm" }))).toBe(true);
    expect(isTilerGpu(gpuOf({ renderer: "Mali-G68" }))).toBe(true);
    expect(isTilerGpu(gpuOf({ vendor: "apple", architecture: "common-3" }))).toBe(true);
    expect(isTilerGpu(gpuOf({ renderer: "Adreno (TM) 740" }))).toBe(true);
    expect(isTilerGpu(gpuOf({ renderer: "PowerVR Rogue GE8320" }))).toBe(true);
    expect(isTilerGpu(gpuOf({ vendor: "nvidia", architecture: "ampere" }))).toBe(false);
    expect(isTilerGpu(gpuOf({ vendor: "harmony-labs", renderer: "charming" }))).toBe(false);
    expect(isTilerGpu(gpuOf({}))).toBe(false);
    expect(isTilerGpu(null)).toBe(false);
  });
});

describe("gpuShare", () => {
  it("rounds a pass's share of its frame to 0.05 within 0..1 and answers null without a frame GPU (bug: a share the UI cannot show, or a division by 0)", () => {
    expect(gpuShare(1, 3)).toBe(0.35);
    expect(gpuShare(0.3, 3.1)).toBe(0.1);
    expect(gpuShare(5, 3)).toBe(1);
    expect(gpuShare(2, 0)).toBeNull();
    expect(gpuShare(Number.NaN, 3)).toBeNull();
    expect(gpuShare(1, Number.NaN)).toBeNull();
  });
});
