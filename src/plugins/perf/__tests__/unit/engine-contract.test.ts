import type {
  PerfEventLine as EngineEventLine,
  PerfEventName as EngineEventName,
  FrameRecord as EngineFrameRecord,
  PerfHeaderLine as EngineHeaderLine,
  PerfLogLine as EngineLogLine,
  PerfMeasured as EngineMeasured,
  PerfSampleLine as EngineSampleLine,
  PerfSpikeLine as EngineSpikeLine,
  Renderer,
  Time
} from "@moku-labs/game";
import {
  PERF_GAP_BUCKETS as ENGINE_GAP_BUCKETS,
  PERF_LOG_VERSION as ENGINE_LOG_VERSION,
  frameAt
} from "@moku-labs/game";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import type {
  FrameRate,
  FrameRecord,
  KeptStats,
  MonitorLike,
  PerfEventLine,
  PerfEventName,
  PerfHeaderLine,
  PerfLogLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSpikeLine,
  RateChange,
  RateMode,
  RateReason,
  RenderStatsLike,
  ThermalStatus
} from "../../protocol";
import { CAUSE_BITS, changesOf, PERF_GAP_BUCKETS, PERF_LOG_VERSION, PHASES } from "../../protocol";

// ─────────────────────────────────────────────────────────────────────────────
// The editor's view of the engine against the engine itself (spec 03 § Against
// the shipped engine): every type perf/protocol keeps or extends, the editor
// constants, and the fake monitor's ring read by the engine's own frameAt.
// Built against the engine PR preview: specs 21 (rate) and 23 (kept) are in it;
// 22 (overlay detail), 25 (pool-trim), 26 (redraws), 27 (warm) are not yet.
// ─────────────────────────────────────────────────────────────────────────────

describe("the types perf/protocol extends", () => {
  it("lets every engine line into the editor's union, and the editor's header, sample, frame record and spike line back (bug: a mirror that drifted from the engine)", () => {
    expectTypeOf<EngineLogLine>().toExtend<PerfLogLine>();
    expectTypeOf<EngineHeaderLine>().toExtend<PerfHeaderLine>();
    expectTypeOf<PerfHeaderLine>().toExtend<EngineHeaderLine>();
    expectTypeOf<EngineSampleLine>().toExtend<PerfSampleLine>();
    expectTypeOf<PerfSampleLine>().toExtend<EngineSampleLine>();
    expectTypeOf<EngineFrameRecord>().toExtend<FrameRecord>();
    expectTypeOf<FrameRecord>().toExtend<EngineFrameRecord>();
    expectTypeOf<EngineSpikeLine>().toExtend<PerfSpikeLine>();
    expectTypeOf<PerfSpikeLine>().toExtend<EngineSpikeLine>();
    expectTypeOf<EngineEventLine>().toExtend<PerfEventLine>();
    expect(PERF_LOG_VERSION).toBe(ENGINE_LOG_VERSION);
  });

  it("adds exactly the event names and measures the engine does not have yet (devtools is the engine's)", () => {
    expectTypeOf<Exclude<PerfEventName, EngineEventName>>().toEqualTypeOf<"pool-trim" | "warm">();
    expectTypeOf<Exclude<EngineEventName, PerfEventName>>().toEqualTypeOf<never>();
    expectTypeOf<"devtools" | "overlay" | "rate">().toExtend<EngineEventName>();
    expectTypeOf<PerfMeasured>().toEqualTypeOf<EngineMeasured>();
    expect(ENGINE_GAP_BUCKETS).toBe(PERF_GAP_BUCKETS);
  });

  it("takes the spec 21 rate types and the header's rate from the engine (bug: a rate line the editor reads with another shape)", () => {
    expectTypeOf<PerfHeaderLine>().toEqualTypeOf<EngineHeaderLine>();
    expectTypeOf<NonNullable<PerfHeaderLine["rate"]>>().toEqualTypeOf<Readonly<Time.FrameRate>>();
    expectTypeOf<FrameRate>().toEqualTypeOf<Time.FrameRate>();
    expectTypeOf<RateChange>().toEqualTypeOf<Time.RateChange>();
    expectTypeOf<RateMode>().toEqualTypeOf<Time.RateMode>();
    expectTypeOf<RateReason>().toEqualTypeOf<Time.RateReason>();
    expectTypeOf<ThermalStatus>().toEqualTypeOf<Time.ThermalStatus>();
    expect(PERF_LOG_VERSION).toBe(1);
  });

  it("takes the spec 23 kept fields from the engine: sample, frame record, spike line, measures, KeptStats, stats() (bug: a kept counter read with another shape)", () => {
    expectTypeOf<PerfSampleLine>().toEqualTypeOf<EngineSampleLine>();
    expectTypeOf<FrameRecord>().toEqualTypeOf<EngineFrameRecord>();
    expectTypeOf<PerfSpikeLine>().toEqualTypeOf<EngineSpikeLine>();
    expectTypeOf<KeptStats>().toEqualTypeOf<Renderer.KeptStats>();
    expectTypeOf<RenderStatsLike["kept"]>().toEqualTypeOf<Renderer.RenderStats["kept"]>();
    expectTypeOf<RenderStatsLike["renderPassesMax"]>().toEqualTypeOf<
      Renderer.RenderStats["renderPassesMax"]
    >();
    expect(PHASES).toHaveLength(6);
  });

  it("marks the fields still pending in the engine (specs 25, 26, 27; 22 O10.2 has no engine type to check); when one lands this fails and the addition is dropped", () => {
    expectTypeOf<
      "redraws" extends keyof Renderer.RenderStats ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "rebuilds" extends keyof Renderer.RenderStats ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<
      "pool-trim" | "warm" extends EngineEventName ? true : false
    >().toEqualTypeOf<false>();
    expect(PHASES).toHaveLength(6);
  });

  it("takes the engine's monitor as a MonitorLike and the engine's renderPasses for RenderStatsLike", () => {
    expectTypeOf<Renderer.PerfMonitorApi>().toExtend<MonitorLike>();
    expectTypeOf<RenderStatsLike["renderPasses"]>().toEqualTypeOf<
      Renderer.RenderStats["renderPasses"]
    >();
    expect(CAUSE_BITS).toHaveLength(7);
  });
});

describe("the editor constants against the engine's frameAt", () => {
  it("reads phaseMs in PHASES order (bug: a phase shown under another's name)", () => {
    const monitor = createFakeMonitor({ capacity: 8 });
    monitor.commit({ t: 0, phaseMs: [1, 2, 3, 4, 5, 6], agentMs: 0.5 });
    const record = frameAt(monitor.frames(), 0);
    expect(PHASES.map(phase => record?.phases[phase])).toEqual([1, 2, 3, 4, 5, 6]);
    expect(record?.phases.agent).toBe(0.5);
  });

  it("names each cause bit as CAUSE_BITS does (bug: a spike coloured by the wrong cause)", () => {
    const monitor = createFakeMonitor({ capacity: 8 });
    for (const [bit, cause] of CAUSE_BITS.entries()) {
      monitor.commit({ t: bit * 16, causes: 1 << bit });
      expect(frameAt(monitor.frames(), 0)?.causes).toEqual([cause]);
    }
  });

  it("names each change bit as changesOf does (bug: a bundle change shown as a scene change)", () => {
    const monitor = createFakeMonitor({ capacity: 8 });
    for (let bit = 0; bit < 5; bit += 1) {
      monitor.commit({ t: bit * 16, changed: 1 << bit });
      expect(frameAt(monitor.frames(), 0)?.changed.map(change => change.kind)).toEqual(
        changesOf(1 << bit)
      );
    }
  });

  it("reads the fake ring's budget and rate columns, slot = k % capacity (the fake follows the engine's ring)", () => {
    const monitor = createFakeMonitor({ capacity: 4 });
    for (let index = 0; index < 6; index += 1) {
      monitor.commit({ t: index * 8.33, rateMs: 8.33, budgetMs: index === 5 ? 16.7 : 8.33 });
    }
    const ring = monitor.frames();
    expect(frameAt(ring, 0)).toMatchObject({ frame: 6, budgetMs: 16.7, rateMs: 8.33 });
    expect(ring.columns.frame[5 % ring.capacity]).toBe(6);
    expect(frameAt(ring, 4)).toBeUndefined();
  });

  it("keeps frame k in slot k % capacity across the engine's stop and start (engine fix A, the fake included)", () => {
    const monitor = createFakeMonitor({ capacity: 8 });
    for (let index = 0; index < 3; index += 1) monitor.commit({ t: index * 16 });
    monitor.restart();
    const frame = monitor.commit({ t: 100 });
    const ring = monitor.frames();
    expect(ring.columns.frame[3 % ring.capacity]).toBe(frame);
    expect([ring.newest, ring.size, ring.written]).toEqual([3, 1, 4]);
    expect(frameAt(ring, 0)?.frame).toBe(frame);
  });

  it("reads the fake ring's kept and retakes columns as the engine's frame record does (spec 23 P12.2)", () => {
    const monitor = createFakeMonitor({ capacity: 4 });
    monitor.commit({ t: 0 });
    expect(frameAt(monitor.frames(), 0)?.kept).toBeNull();
    monitor.commit({ t: 16, kept: 2, retakes: 1 });
    expect(frameAt(monitor.frames(), 0)?.kept).toEqual({ pictures: 2, retakes: 1 });
    expect(frameAt(monitor.frames(), 0)?.reason).toBeNull();
  });
});
