/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's header */
import { describe, expect, it } from "vitest";
import {
  ENGINE_0_15_0,
  gcLine,
  headerLine,
  problemLine
} from "../../../../../tests/fixtures/fake-monitor";
import type { PerfFramesWire } from "../../protocol";
import { capsOf } from "../../protocol";
import { secondOf } from "../../records";
import { feedRig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/guards capsOf (spec 03 Delta 2026-10-16 D2): what this page's engine
// and build measure, decided once per header. "Not measured" (a false
// capability) is never shown as 0.
// ─────────────────────────────────────────────────────────────────────────────

/** Pass ring slots of the test rings. */
const SLOTS = 8;

/**
 * A pass ring of the 0.15.x patch: owner, kind2 and its names, drawsAt, format and resolution.
 *
 * @returns The ring's `passes`.
 */
function patchedPasses() {
  return {
    capacity: SLOTS,
    written: 0,
    frame: new Uint32Array(SLOTS),
    owner: new Uint32Array(SLOTS),
    kind2: new Uint8Array(SLOTS),
    kindNames: ["fog.blur", "colorMatrix"],
    drawsAt: new Uint16Array(SLOTS),
    format: Array.from<string | null>({ length: SLOTS }).fill(null),
    resolution: new Float32Array(SLOTS)
  };
}

/** A ring of an engine before the 0.15.x patch: none of its pass columns, no system names. */
const OLD_RING = { capacity: 1024, passes: { capacity: SLOTS, frame: new Uint32Array(SLOTS) } };

/** A ring of the 0.15.x patch. */
const PATCHED_RING = { capacity: 1024, passes: patchedPasses(), systemNames: ["ward.update"] };

describe("capsOf", () => {
  it("reads every 0.15.x column of a patched ring as measured (bug: a patched phone's owners and draws shown as 'not measured on this engine')", () => {
    const caps = capsOf(PATCHED_RING, headerLine(), undefined);
    expect(caps).toMatchObject({
      passOwners: true,
      passDraws: true,
      passFormat: true,
      systemNames: true,
      shaderEvents: true
    });
  });

  it("answers false for an engine without the columns (bug: '0 draws' or owner 0 shown for an engine that does not count them)", () => {
    const caps = capsOf(OLD_RING, headerLine(), undefined);
    expect(caps).toMatchObject({
      passOwners: false,
      passDraws: false,
      passFormat: false,
      systemNames: false,
      shaderEvents: false
    });
  });

  it("answers false for a column of the wrong type or length (bug: a short column read past its end)", () => {
    const passes = {
      ...patchedPasses(),
      owner: Array.from<number>({ length: SLOTS }).fill(0),
      drawsAt: new Uint16Array(SLOTS / 2),
      resolution: undefined
    };
    const caps = capsOf({ capacity: 1024, passes, systemNames: "ward.update" }, headerLine(), {});
    expect(caps).toMatchObject({
      passOwners: false,
      passDraws: false,
      passFormat: false,
      systemNames: false
    });
  });

  it("answers no GPU timer for a header without one and before any header (bug: iOS shown with 0 ms GPU)", () => {
    const gpu = { ...headerLine().gpu, timer: null };
    expect(capsOf(PATCHED_RING, headerLine({ gpu }), undefined).gpuTimer).toBe(false);
    expect(capsOf(PATCHED_RING, headerLine(), undefined).gpuTimer).toBe(true);
    expect(capsOf(PATCHED_RING, undefined, undefined).gpuTimer).toBe(false);
  });

  it("trusts the heap only outside a WebView, and has none without heap in measured (bug: the A26's frozen heap trusted, iOS read as 0 MB)", () => {
    const desktop = { ...headerLine().device, webview: null };
    expect(capsOf(OLD_RING, headerLine({ measured: ["gpu"] }), undefined).heap).toBe("none");
    expect(capsOf(OLD_RING, headerLine({ measured: ["heap"] }), undefined).heap).toBe("untrusted");
    expect(
      capsOf(OLD_RING, headerLine({ measured: ["heap"], device: desktop }), undefined).heap
    ).toBe("trusted");
  });

  it("reads problems and gc from the header and sections and detail from the monitor, never throwing on a hostile monitor (bug: a half-built monitor crashing perf's read)", () => {
    const measured = ["gpu", "problems", "gc"] as unknown as ReturnType<
      typeof headerLine
    >["measured"];
    const caps = capsOf(OLD_RING, headerLine({ measured }), {
      sections: () => ({}),
      detail: () => ({})
    });
    expect(caps).toMatchObject({ problems: true, gc: true, sections: true, detail: true });

    const hostile = {
      get sections(): never {
        throw new Error("half-built");
      }
    };
    const plain = capsOf(OLD_RING, headerLine(), hostile);
    expect(plain).toMatchObject({
      problems: false,
      gc: false,
      sections: false,
      detail: false,
      passesLine: false
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The agent's capabilities and its pass rows on an engine before the patch.
// ─────────────────────────────────────────────────────────────────────────────

describe("perf on an engine without the 0.15.x columns", () => {
  it("sends its pass rows with owner, filter, draws and format null, and says so in second().caps (bug: '0 draws' or owner 0 shown for an engine that does not count them)", () => {
    const { monitor, tick, read, state } = feedRig({ feedPasses: true }, ENGINE_0_15_0);
    monitor.commit({ t: 0, draws: 42 });
    monitor.commitPass({ kind: "filter", owner: 412, filter: "fog.blur", drawsAt: 3 });
    tick();

    expect((read("editor.perf.frames") as PerfFramesWire).passes).toEqual({
      row: [0],
      index: [0],
      kind: ["filter"],
      view: [null],
      owner: [null],
      filter: [null],
      w: [1080],
      h: [2340],
      format: [null],
      resolution: [null],
      draws: [null],
      gpuMs: [null]
    });
    expect(secondOf(state).caps).toMatchObject({
      passOwners: false,
      passDraws: false,
      passFormat: false,
      systemNames: true,
      sections: false,
      detail: false
    });
  });

  it("turns a capability on when its line arrives (bug: a problem the engine sent shown as not measured)", () => {
    const { monitor, state } = feedRig({}, ENGINE_0_15_0);
    expect(state.caps.problems).toBe(false);
    monitor.emit(problemLine());
    monitor.emit(gcLine());
    expect(secondOf(state).caps).toMatchObject({ problems: true, gc: true });
  });
});
