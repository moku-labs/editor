/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's header */
import { describe, expect, it } from "vitest";
import { headerLine } from "../../../../../tests/fixtures/fake-monitor";
import { capsOf } from "../../protocol";

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
