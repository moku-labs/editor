/* eslint-disable unicorn/no-null -- null is "not measured" in the engine's lines and perf's values */
import { describe, expect, it } from "vitest";
import {
  createFakeMonitor,
  DISPLAY,
  eventLine,
  frameRecord,
  headerLine,
  sampleLine,
  spikeLine
} from "../../../../../tests/fixtures/fake-monitor";
import { attach, perfState } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// stream: the lines perf keeps from monitor.stream, by reference.
// ─────────────────────────────────────────────────────────────────────────────

describe("listen", () => {
  it("keeps the header at subscribe: its display, and a null GPU timer turns gpuTimer off", () => {
    const { state } = perfState();
    const header = headerLine({ gpu: { ...headerLine().gpu, timer: null } });
    attach(state, createFakeMonitor({ header }));
    expect(state.header?.engine).toBe("0.14.12+9c41e0");
    expect(state.display).toEqual(DISPLAY);
    expect(state.window.gpuTimer).toBe(false);
  });

  it("replaces the display with a display event and ignores a malformed one", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    const turned = { ...DISPLAY, orientation: "landscape", canvas: { w: 2340, h: 1080 } };
    monitor.emit(eventLine("display", 40, turned));
    expect(state.display?.orientation).toBe("landscape");
    monitor.emit(eventLine("display", 41, { dpr: 3 }));
    expect(state.display?.orientation).toBe("landscape");
  });

  it("keeps the newest sample and drops the cached second", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    monitor.emit(sampleLine(60));
    const newest = sampleLine(120);
    state.second = undefined;
    monitor.emit(newest);
    expect(state.sample).toBe(newest);
  });

  it("keeps the 64 newest spike lines by reference (bug: a copy per line)", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    const lines = Array.from({ length: 65 }, (_, index) => spikeLine(frameRecord(index + 1)));
    for (const line of lines) monitor.emit(line);
    expect(state.spikeLines).toHaveLength(64);
    expect(state.spikeLines[0]).toBe(lines[64]);
    expect(state.spikeLines[1]).toBe(lines[1]);
    expect(state.spikeLines).not.toContain(lines[0]);
  });

  it("keeps overlay, pool-trim and warm lines in 32 slots by reference, the 33rd over the oldest", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    const first = eventLine("overlay", 1, {
      entity: 1,
      label: "shop",
      what: "open",
      mode: "modal"
    });
    monitor.emit(first);
    for (let frame = 2; frame <= 32; frame += 1) {
      monitor.emit(eventLine(frame % 2 === 0 ? "warm" : "pool-trim", frame, { draws: 1 }));
    }
    expect(state.frameEvents[0]).toBe(first);
    const thirtyThird = eventLine("warm", 33, { draws: 2 });
    monitor.emit(thirtyThird);
    expect(state.frameEvents[0]).toBe(thirtyThird);
  });

  it("keeps none of the editor's devtools, command and recorder lines (bug: the editor's own events crowding out the game's)", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    monitor.emit(eventLine("devtools", 5, { mode: "card", tab: "frames" }));
    monitor.emit(eventLine("command", 5, { id: "game.step" }));
    monitor.emit(eventLine("recorder", 5, { action: "start" }));
    monitor.emit(eventLine("scene", 5, { scene: "board" }));
    expect([state.frameEventNext, state.rateLineNext]).toEqual([0, 0]);
    expect(state.frameEvents.every(line => line === undefined)).toBe(true);
  });

  it("keeps rate lines in 16 slots and tells the watches", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    let calls = 0;
    state.watchers.add(() => {
      calls += 1;
    });
    const line = eventLine("rate", 9, { from: 120, to: 60 });
    monitor.emit(line);
    expect([state.rateLines[0], state.rateLineNext, calls]).toEqual([line, 1, 1]);
  });

  it("changes nothing for a mark, a long frame or a thermal line", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    const before = { ...state, window: state.window.version };
    monitor.emit({ v: 1, kind: "mark", t: 1, build: null, label: "boss", auto: false });
    expect([state.sample, state.window.version, state.frameEventNext]).toEqual([
      before.sample,
      before.window,
      0
    ]);
  });

  it("tells the watches inside the monitor's agent span, closed also when a watch throws (spec 03 step 10)", () => {
    const { state } = perfState();
    const monitor = createFakeMonitor();
    attach(state, monitor);
    const open: number[] = [];
    state.watchers.add(() => {
      open.push(monitor.begins - monitor.ends);
      throw new Error("watch broke");
    });
    const before = [monitor.begins, monitor.ends];
    monitor.emit(sampleLine(60));
    monitor.emit(eventLine("display", 61, DISPLAY));
    monitor.emit(eventLine("rate", 62, {}));
    expect(open).toEqual([1, 1, 1]);
    expect([monitor.begins - (before[0] ?? 0), monitor.ends - (before[1] ?? 0)]).toEqual([3, 3]);
  });
});
