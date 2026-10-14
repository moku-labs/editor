/* eslint-disable unicorn/no-null -- null is the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { recordView } from "../../device/record";
import { recorderOf, recordOf, spikeLineOf } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// device/record.ts: the rows of the spike record side panel (design §7) from
// one PerfSpikeRecord and the recorder's clock.
// ─────────────────────────────────────────────────────────────────────────────

describe("the record header", () => {
  it("'x s ago' is the record's agoMs", () => {
    const view = recordView(recordOf({ agoMs: 980 }), undefined);

    expect(view.title).toBe("Frame 4812");
    expect(view.sub).toBe("0.98 s ago");
  });

  it("adds 'log mm:ss.s' while recording: the recorder's sinceMs minus agoMs", () => {
    const view = recordView(recordOf({ agoMs: 980 }), recorderOf({ sinceMs: 192_000 }));

    expect(view.sub).toBe("0.98 s ago, log 03:11.0");
  });

  it("'log mm:ss.s' is left out when the recorder is idle or the spike came before the start", () => {
    expect(recordView(recordOf(), recorderOf({ state: "idle", sinceMs: 0 })).sub).toBe(
      "0.98 s ago"
    );
    expect(recordView(recordOf({ agoMs: 5000 }), recorderOf({ sinceMs: 3000 })).sub).toBe(
      "5.00 s ago"
    );
  });
});

describe("the record lead", () => {
  it("lists every cause, the primary lit and first, GC? hollow, with the primary's word", () => {
    const view = recordView(
      recordOf({ cause: "upload", causes: ["upload", "gap", "gc?"] }),
      undefined
    );

    expect(view.causes.map(cause => [cause.legend, cause.lit, cause.hollow])).toEqual([
      ["UP", true, false],
      ["GAP", false, false],
      ["GC?", false, true]
    ]);
    expect(view.word).toBe("Upload");
  });

  it("a frame over twice its own budget is red, under it amber", () => {
    const red = recordView(recordOf({ ms: 20, budgetMs: 8.3, overMs: 11.7, fps: 120 }), undefined);
    const amber = recordView(recordOf({ ms: 16, budgetMs: 8.3, overMs: 7.7, fps: 120 }), undefined);

    expect(red.severity).toBe("red");
    expect(amber.severity).toBe("amber");
  });

  it("the lead reads the budget from the frame's own budgetMs", () => {
    const view = recordView(
      recordOf({ ms: 12, budgetMs: 16.7, overMs: -4.7, fps: 120 }),
      undefined
    );

    expect(view.budget).toBe("16.7");
    expect(view.ms).toBe("12.0");
  });

  it("the why line carries the primary cause's hue", () => {
    expect(recordView(recordOf(), undefined).hue).toBe("#B58CFF");
  });
});

describe("the record details", () => {
  it("phase bars scale to the slowest phase", () => {
    const view = recordView(recordOf(), undefined);

    expect(view.phases.find(row => row.label === "render")).toEqual({
      label: "render",
      value: "3.1",
      share: 1
    });
    expect(view.phases.find(row => row.label === "sync")?.share).toBeCloseTo(2.2 / 3.1);
  });

  it("a record without GPU time reads 'GPU — no timer' and lists no passes", () => {
    const view = recordView(recordOf({ gpuMs: null }), undefined);

    expect(view.gpuTitle).toBe("GPU — no timer");
    expect(view.passes).toEqual([]);
  });

  it("a pass without a label shows its kind; the GPU title counts the passes", () => {
    const view = recordView(recordOf(), undefined);

    expect(view.gpuTitle).toBe("GPU 6.6 ms over 2 passes");
    expect(view.passes.map(pass => pass.label)).toEqual(["canvas", "glass"]);
  });

  it("uploads of 1 MB or more are amber", () => {
    const view = recordView(recordOf(), undefined);
    const small = recordView(recordOf({ uploads: { count: 1, mb: 0.4 } }), undefined);

    expect(view.thisFrame.find(row => row.label === "uploads")).toEqual({
      label: "uploads",
      value: "41.0 MB",
      tone: "warn"
    });
    expect(small.thisFrame.find(row => row.label === "uploads")?.tone).toBe("value");
  });

  it("what changed joins kind and subject and adds the rate switch", () => {
    const view = recordView(
      recordOf({ rateSwitch: { from: 120, to: 60, reason: "missed", mode: "auto" } }),
      undefined
    );

    expect(view.changed).toBe("bundle garden-boss · rate 120 → 60 (missed, auto)");
  });

  it("what changed lists the game overlay that opened in the frame by its label", () => {
    const view = recordView(
      recordOf({
        events: [
          { kind: "overlay", frame: 4812, label: "shopDimLayer", what: "open", mode: "freeze" }
        ]
      }),
      undefined
    );

    expect(view.changed).toBe("bundle garden-boss · shopDimLayer open");
  });

  it("what changed lists the pool trim of the frame before", () => {
    const view = recordView(
      recordOf({ events: [{ kind: "pool-trim", frame: 4811, reason: "rest", freedMb: 41.5 }] }),
      undefined
    );

    expect(view.changed).toContain("pool trim −41.5 MB (rest)");
  });

  it("a warm-up prints as words, not JSON", () => {
    const view = recordView(
      recordOf({ events: [{ kind: "warm", frame: 4812, draws: 12 }] }),
      undefined
    );

    expect(view.changed).toContain("warm-up 12 draws");
  });

  it("without detail the ring numbers show with the note", () => {
    const view = recordView(
      recordOf({
        detail: null,
        phases: {
          input: 0.2,
          animate: 1,
          layout: 0.4,
          sync: 2,
          signals: 0.3,
          render: 3,
          agent: 0.1
        },
        filters: { applies: 4, mpx: 2.1 }
      }),
      undefined
    );

    expect(view.note).toBe("More detail arrives with the log line in about a second.");
    expect(view.phases).toHaveLength(7);
    expect(view.gpuTitle).toBe("GPU 6.6 ms over 2 passes");
    expect(view.filters).toEqual([{ label: "all", value: "4×, 2.1 Mpx", tone: "plain" }]);
    expect(view.changed).toBe("bundle");
    expect(view.thisFrame.find(row => row.label === "long frame")?.value).toBe("—");
  });

  it("with detail: slowest systems first, filters per kind, long frame 'none'", () => {
    const view = recordView(recordOf({ detail: spikeLineOf() }), undefined);

    expect(view.systems?.map(row => row.label)).toEqual(["frost-apply", "ripple"]);
    expect(view.filters).toEqual([{ label: "blur", value: "3×, 1.5 Mpx", tone: "plain" }]);
    expect(view.thisFrame.find(row => row.label === "long frame")?.value).toBe("none");
    expect(view.note).toBeUndefined();
  });
});
