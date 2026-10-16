/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { graphFlags } from "../../derive/mission";
import { SECTION_DEFAULTS } from "../../source/contract";
import { createRenderViewState } from "../../state";
import { secondOf } from "../device-fixtures";
import { CONFIG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// derive/mission.ts graphFlags (spec 09 § M8 items 4, 6; honest limits): GC
// marks are "none" without a memory source (never drawn from an untrusted
// heap), "off" when Memory & GC is switched off; GPU time is "not measured"
// without a timer and "off" when GPU timing is switched off; the lane follows
// Shaders & passes.
// ─────────────────────────────────────────────────────────────────────────────

const MONITOR = {
  engine: true,
  sections: { ...SECTION_DEFAULTS, passes: false, shaders: false },
  feeds: { passes: false, systems: true, nodes: false },
  costMs: null,
  monitorMs: null,
  editorMs: null,
  overdraw: false
};

const TRUSTED = {
  heapMb: 20,
  source: "performance.memory",
  trusted: true,
  why: null,
  processMb: null
} as const;

function missionWith(second: ReturnType<typeof secondOf> | undefined, device = false) {
  const { mission } = createRenderViewState({ config: CONFIG });
  mission.second = second;
  mission.history.gpuTimer = true;
  if (device) {
    mission.source = {
      kind: "device",
      session: "s-9",
      device: {
        id: "d-7f3a",
        model: "SM-A266B",
        link: "adb",
        address: "127.0.0.1",
        port: 47_600,
        engine: null,
        build: null
      }
    };
  }
  return mission;
}

describe("the graph flags", () => {
  it("draws no GC marks on a device whose only heap is the WebView's (untrusted)", () => {
    const untrusted = { ...TRUSTED, trusted: false, why: "webview" as const };
    expect(
      graphFlags(missionWith(secondOf({ memory: untrusted, monitor: MONITOR }), true)).gc
    ).toBe("none");
  });

  it("GC marks are off with Memory & GC switched off, on with it on", () => {
    const off = { ...MONITOR, sections: { ...MONITOR.sections, memory: false } };
    expect(graphFlags(missionWith(secondOf({ memory: TRUSTED, monitor: off }))).gc).toBe("off");
    expect(graphFlags(missionWith(secondOf({ memory: TRUSTED, monitor: MONITOR }))).gc).toBe("on");
  });

  it("GPU is not measured without a timer, off when switched off, and the lane follows passes", () => {
    const flags = graphFlags(missionWith(secondOf({ memory: TRUSTED, monitor: MONITOR })));
    expect(flags.gpu).toBe("on");
    expect(flags.passes).toBe(false);

    const noTimer = missionWith(secondOf({ memory: TRUSTED, monitor: MONITOR }));
    noTimer.history.gpuTimer = false;
    expect(graphFlags(noTimer).gpu).toBe("not-measured");

    const gpuOff = { ...MONITOR, sections: { ...MONITOR.sections, gpu: false } };
    expect(graphFlags(missionWith(secondOf({ memory: TRUSTED, monitor: gpuOff }))).gpu).toBe("off");
  });
});
