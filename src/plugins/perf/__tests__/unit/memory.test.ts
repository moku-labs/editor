/* eslint-disable unicorn/no-null -- null is "no heap number" and "not a WebView" in the engine's lines */
import { describe, expect, it } from "vitest";
import { headerLine, sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import { memoryWhy } from "../../protocol";
import { secondOf } from "../../records";
import { commitFrames, feedRig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// protocol/memory (spec 03 Delta 2026-10-16 D6): perf never presents a heap it
// cannot stand behind. On the A26 WebView `performance.memory` stayed one value
// for 30 s while the real heap moved.
// ─────────────────────────────────────────────────────────────────────────────

describe("memoryWhy", () => {
  it("answers not-measured for a page without a heap number (bug: iOS shown as 0 MB)", () => {
    expect(memoryWhy(null, null, 0)).toBe("not-measured");
    expect(memoryWhy(Number.NaN, null, 0)).toBe("not-measured");
  });

  it("never trusts a WebView's heap, even while it moves (bug: the A26's frozen 10.68 MB shown as the heap)", () => {
    expect(memoryWhy(10.68, "141", 1)).toBe("webview");
  });

  it("calls a desktop counter frozen at 20 equal samples and still trusts it at 19 (bug: a frozen counter drawn as a flat 'no leak' line)", () => {
    expect(memoryWhy(41.9, null, 19)).toBeNull();
    expect(memoryWhy(41.9, null, 20)).toBe("frozen");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The agent's second().memory (D6): the newest sample's heap, the WebView rule
// and the frozen-counter count of feeds/memory noteHeap.
// ─────────────────────────────────────────────────────────────────────────────

/** A desktop page: no WebView in the header. */
const DESKTOP = headerLine({ device: { ...headerLine().device, webview: null } });

describe("second().memory", () => {
  it("never trusts the heap of a WebView (bug: the A26's frozen 10.68 MB shown as the heap)", () => {
    const { monitor, state } = feedRig();
    monitor.emit(sampleLine(10, { heapMb: 10.68 }));
    expect(secondOf(state).memory).toEqual({
      heapMb: 10.68,
      source: "performance.memory",
      trusted: false,
      why: "webview",
      processMb: null
    });
  });

  it("calls a desktop counter frozen at its 20th equal sample of an awake page, and trusts it again once it moves (bug: a frozen counter drawn as a flat 'no leak' line)", () => {
    const { monitor, state, tick } = feedRig({}, { header: DESKTOP });
    commitFrames(monitor, 60, 0, 16.7);
    tick();
    for (let index = 0; index < 19; index += 1) monitor.emit(sampleLine(index, { heapMb: 41.9 }));
    expect(secondOf(state).memory).toMatchObject({ trusted: true, why: null });
    monitor.emit(sampleLine(20, { heapMb: 41.9 }));
    expect(secondOf(state).memory).toMatchObject({ trusted: false, why: "frozen" });
    monitor.emit(sampleLine(21, { heapMb: 42.3 }));
    expect(secondOf(state).memory).toMatchObject({ heapMb: 42.3, trusted: true, why: null });
  });

  it("does not count equal samples while the screen rests: a still page's heap is flat for a reason", () => {
    const { monitor, state, tick } = feedRig({}, { header: DESKTOP });
    commitFrames(monitor, 60, 0, 33.3, { idle: true, drawn: false });
    tick();
    for (let index = 0; index < 25; index += 1) monitor.emit(sampleLine(index, { heapMb: 41.9 }));
    expect(secondOf(state).memory).toMatchObject({ trusted: true, why: null });
  });

  it("says not-measured without a heap number (bug: iOS shown as 0 MB)", () => {
    const { monitor, state } = feedRig({}, { header: DESKTOP });
    monitor.emit(sampleLine(10, { heapMb: null }));
    expect(secondOf(state).memory).toEqual({
      heapMb: null,
      source: null,
      trusted: false,
      why: "not-measured",
      processMb: null
    });
  });
});

describe("second().memory's source", () => {
  it("is the engine's memory.source when the sample says (bug: a measureUserAgentSpecificMemory heap labelled performance.memory)", () => {
    const { monitor, state } = feedRig({}, { header: DESKTOP });
    monitor.emit(
      sampleLine(10, { heapMb: 52.4, memory: { source: "uasm", heapMb: 52.4, processMb: 180 } })
    );
    expect(secondOf(state).memory).toMatchObject({
      heapMb: 52.4,
      source: "uasm",
      processMb: 180
    });
  });
});
