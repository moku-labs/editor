import { readFileSync } from "node:fs";
import type {
  PerfEventLine as EngineEventLine,
  PerfEventName as EngineEventName,
  FrameRecord as EngineFrameRecord,
  FrameRing as EngineFrameRing,
  PerfHeaderLine as EngineHeaderLine,
  PerfLogLine as EngineLogLine,
  PerfMeasured as EngineMeasured,
  OverlayEventDetail as EngineOverlayEventDetail,
  OverlayWhat as EngineOverlayWhat,
  PerfCounts as EnginePerfCounts,
  PoolTrimDetail as EnginePoolTrimDetail,
  ProblemEventDetail as EngineProblemEventDetail,
  ProblemRule as EngineProblemRule,
  PerfSampleLine as EngineSampleLine,
  ShaderEventDetail as EngineShaderEventDetail,
  ShaderWhat as EngineShaderWhat,
  PerfSpikeLine as EngineSpikeLine,
  WarmDetail as EngineWarmDetail,
  Renderer,
  Time
} from "@moku-labs/game";
import * as engine from "@moku-labs/game";
import {
  DEMAND_REASONS,
  PERF_GAP_BUCKETS as ENGINE_GAP_BUCKETS,
  PERF_LOG_VERSION as ENGINE_LOG_VERSION,
  PASS_KINDS as ENGINE_PASS_KINDS,
  PROBLEM_RULES as ENGINE_PROBLEM_RULES,
  SHADER_WHATS as ENGINE_SHADER_WHATS,
  frameAt,
  PERF_CAUSES
} from "@moku-labs/game";
import { describe, expect, expectTypeOf, it } from "vitest";
import { createFakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import type {
  FrameRate,
  FrameRateNext,
  FrameRecord,
  KeptStats,
  MonitorLike,
  OverlayEventDetail,
  OverlayWhat,
  PassColumnsNext,
  PerfEventLine,
  PerfEventName,
  PerfEventNameNext,
  PerfFramesWire,
  PerfHeaderLine,
  PerfHeaderNext,
  PerfLogLine,
  PerfMeasured,
  PerfSampleLine,
  PerfSampleNext,
  PerfSpikeLine,
  PoolTrimDetail,
  ProblemEventDetail,
  RateChange,
  RateMode,
  RateReason,
  RenderStatsLike,
  RingNamesNext,
  ShaderEventDetail,
  ThermalStatus,
  WarmDetail
} from "../../protocol";
import {
  CAUSE_BITS,
  changesOf,
  MONITOR_SECTIONS,
  PASS_KINDS,
  PERF_GAP_BUCKETS,
  PERF_LOG_VERSION,
  PHASES,
  PROBLEM_RULES,
  SHADER_WHATS
} from "../../protocol";
import { REASON_NONE } from "../../ring";
import { feedRig } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The editor's view of the engine against the engine itself (spec 03 § Against
// the shipped engine): every type perf/protocol re-exports equals the engine's,
// the editor constants match, and the fake monitor's ring is read by the
// engine's own frameAt. The engine now has every type spec 03 names; the only
// editor type left is DevtoolsDetail (the engine names the event, not its detail).
// ─────────────────────────────────────────────────────────────────────────────

describe("the engine types perf/protocol re-exports", () => {
  it("takes the log lines and their union from the engine (bug: a mirror that drifted from the engine)", () => {
    expectTypeOf<PerfLogLine>().toEqualTypeOf<EngineLogLine>();
    expectTypeOf<PerfHeaderLine>().toEqualTypeOf<EngineHeaderLine>();
    expectTypeOf<PerfSampleLine>().toEqualTypeOf<EngineSampleLine>();
    expectTypeOf<PerfSpikeLine>().toEqualTypeOf<EngineSpikeLine>();
    expectTypeOf<PerfEventLine>().toEqualTypeOf<EngineEventLine>();
    expectTypeOf<FrameRecord>().toEqualTypeOf<EngineFrameRecord>();
    expect(PERF_LOG_VERSION).toBe(ENGINE_LOG_VERSION);
  });

  it("takes the event names and measures from the engine, devtools, pool-trim and warm included", () => {
    expectTypeOf<PerfEventName>().toEqualTypeOf<EngineEventName>();
    expectTypeOf<
      "devtools" | "overlay" | "rate" | "pool-trim" | "warm"
    >().toExtend<PerfEventName>();
    expectTypeOf<PerfMeasured>().toEqualTypeOf<EngineMeasured>();
    expect(ENGINE_GAP_BUCKETS).toBe(PERF_GAP_BUCKETS);
  });

  it("takes the spec 21 rate types and the header's rate from the engine (bug: a rate line the editor reads with another shape)", () => {
    expectTypeOf<NonNullable<PerfHeaderLine["rate"]>>().toEqualTypeOf<Readonly<Time.FrameRate>>();
    expectTypeOf<FrameRate>().toEqualTypeOf<Time.FrameRate>();
    expectTypeOf<RateChange>().toEqualTypeOf<Time.RateChange>();
    expectTypeOf<RateMode>().toEqualTypeOf<Time.RateMode>();
    expectTypeOf<RateReason>().toEqualTypeOf<Time.RateReason>();
    expectTypeOf<ThermalStatus>().toEqualTypeOf<Time.ThermalStatus>();
    expect(PERF_LOG_VERSION).toBe(1);
  });

  it("takes the event details of specs 22 O10.2, 25 and 27 from the engine (bug: the editor logging an overlay change with another shape)", () => {
    expectTypeOf<OverlayWhat>().toEqualTypeOf<EngineOverlayWhat>();
    expectTypeOf<OverlayEventDetail>().toEqualTypeOf<EngineOverlayEventDetail>();
    expectTypeOf<PoolTrimDetail>().toEqualTypeOf<EnginePoolTrimDetail>();
    expectTypeOf<WarmDetail>().toEqualTypeOf<EngineWarmDetail>();
    expect(PHASES).toHaveLength(6);
  });

  it("takes the monitor, KeptStats and every RenderStats field perf reads from the engine (specs 23, 26)", () => {
    expectTypeOf<MonitorLike>().toEqualTypeOf<Renderer.PerfMonitorApi>();
    expectTypeOf<KeptStats>().toEqualTypeOf<Renderer.KeptStats>();
    expectTypeOf<RenderStatsLike>().toEqualTypeOf<
      Pick<
        Renderer.RenderStats,
        "renderPasses" | "renderPassesMax" | "kept" | "redraws" | "rebuilds"
      >
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

  it('reads REASON_NONE as the engine\'s "none" draw reason (spec 14: on demand, nothing drawn)', () => {
    const monitor = createFakeMonitor({ capacity: 4 });
    monitor.commit({ t: 0, drawn: false, reason: REASON_NONE });
    expect(frameAt(monitor.frames(), 0)?.reason).toBe("none");
  });
});

describe("the engine's exported lists (game@0fda201: PERF_CAUSES, DEMAND_REASONS)", () => {
  it("reads every draw reason of DEMAND_REASONS through frameAt in ring order (the fake's reason column is the engine's)", () => {
    const monitor = createFakeMonitor({ capacity: 32 });
    for (const [index, reason] of DEMAND_REASONS.entries()) {
      monitor.commit({ t: index * 16, reason: index });
      expect(frameAt(monitor.frames(), 0)?.reason).toBe(reason);
    }
  });

  it("keeps CAUSE_BITS, the engine-free bit order of the wire, the tools page and the server's report, equal to PERF_CAUSES (bug: a tools page naming a spike by another cause)", () => {
    expect([...CAUSE_BITS]).toEqual([...PERF_CAUSES]);
    expectTypeOf<(typeof CAUSE_BITS)[number]>().toEqualTypeOf<(typeof PERF_CAUSES)[number]>();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The 0.15.x patch (spec 03 Delta 2026-10-16 D1, D12, D14; E7) against the dev
// engine (0.15.1): the editor's runtime-free copies of the engine's lists equal
// its root exports, and every mirror holds what the engine's type allows (the
// mirrors stay: the peer floor, 0.15.0, exports none of them). The next
// change's lists and types wait for the engine as listed to-dos, never a silent
// pass. The pass ring's kind2 and the growth of systemNames are read as the
// engine writes them (the fake follows the engine's rules).
// ─────────────────────────────────────────────────────────────────────────────

/** The installed engine's version. */
const ENGINE_VERSION: string = JSON.parse(
  readFileSync(
    new URL("../../../../../node_modules/@moku-labs/game/package.json", import.meta.url),
    "utf8"
  )
).version;

/** A problem detail that opens a problem: the branch without `cleared`. */
type Opened<Detail> = Exclude<Detail, { cleared: true }>;

/** A problem detail that clears one: the branch with `cleared: true`. */
type Cleared<Detail> = Extract<Detail, { cleared: true }>;

describe("the editor's copies of the engine's 0.15.x lists and types (E7, dev engine 0.15.1)", () => {
  it("keeps SHADER_WHATS, PROBLEM_RULES and PASS_KINDS equal to the engine's exports, in order (bug: a shader event, a problem rule or a pass kind byte the tools page names differently from the engine)", () => {
    expect([...SHADER_WHATS]).toEqual([...ENGINE_SHADER_WHATS]);
    expect([...PROBLEM_RULES]).toEqual([...ENGINE_PROBLEM_RULES]);
    expect([...PASS_KINDS]).toEqual([...ENGINE_PASS_KINDS]);
    expectTypeOf<(typeof SHADER_WHATS)[number]>().toEqualTypeOf<EngineShaderWhat>();
    expectTypeOf<(typeof PROBLEM_RULES)[number]>().toEqualTypeOf<EngineProblemRule>();
  });

  it("holds every shader and problem detail the engine writes in the editor's mirrors, field for field (bug: a mirror missing a field the engine sends, or reading one it never sends)", () => {
    expectTypeOf<EngineShaderEventDetail>().toExtend<ShaderEventDetail>();
    expectTypeOf<keyof ShaderEventDetail>().toEqualTypeOf<keyof EngineShaderEventDetail>();
    expectTypeOf<keyof ShaderEventDetail["during"]>().toEqualTypeOf<
      keyof EngineShaderEventDetail["during"]
    >();
    expectTypeOf<EngineProblemEventDetail>().toExtend<ProblemEventDetail>();
    expectTypeOf<keyof Opened<ProblemEventDetail>>().toEqualTypeOf<
      keyof Opened<EngineProblemEventDetail>
    >();
    expectTypeOf<keyof Cleared<ProblemEventDetail>>().toEqualTypeOf<
      keyof Cleared<EngineProblemEventDetail>
    >();
  });

  it("reads the ring's names on the frame ring and the patch's pass columns, sample, header and rate fields through mirrors that hold the engine's types (bug: kindNames looked up on the pass ring, where the engine does not put it)", () => {
    expectTypeOf<
      "kindNames" extends keyof EngineFrameRing["passes"] ? true : false
    >().toEqualTypeOf<false>();
    expectTypeOf<Pick<EngineFrameRing, keyof RingNamesNext>>().toExtend<Required<RingNamesNext>>();
    expectTypeOf<Pick<EngineFrameRing["passes"], keyof PassColumnsNext>>().toExtend<
      Required<PassColumnsNext>
    >();
    expectTypeOf<Pick<EngineSampleLine, "targets" | "counts">>().toExtend<
      Pick<PerfSampleNext, "targets" | "counts">
    >();
    expectTypeOf<NonNullable<PerfSampleNext["counts"]>>().toExtend<EnginePerfCounts>();
    expectTypeOf<Pick<EngineHeaderLine, "app" | "debug">>().toExtend<
      Pick<PerfHeaderNext, "app" | "debug">
    >();
    expectTypeOf<Pick<Time.FrameRate, "asked" | "heldBy">>().toExtend<FrameRateNext>();
    expectTypeOf<"shader" | "problem" | "debug">().toExtend<EngineEventName>();
    expectTypeOf<EngineEventName>().toExtend<PerfEventNameNext>();
  });
});

/** The next change's lists: the editor's copy, compared once the engine exports it. */
const NEXT_LISTS = [["MONITOR_SECTIONS", MONITOR_SECTIONS]] as const;

/** The next change's type mirrors the engine does not export yet (types: tsc, once exported). */
const NEXT_TYPES = [
  "GcEventDetail",
  "MonitorSections",
  "PerfPassesLine",
  "PerfSampleNext (sample shaders, sectionsMs, memory.source)",
  "PerfHeaderNext (header sections)"
] as const;

describe("the editor's copies of the engine's next-change lists and types (E7)", () => {
  for (const [name, copy] of NEXT_LISTS) {
    const exported: unknown = Reflect.get(engine, name);
    if (exported === undefined) {
      it.todo(`TODO(engine): ${name} equals the engine's export (game ${ENGINE_VERSION} has none)`);
      continue;
    }
    it(`keeps ${name} equal to the engine's export (bug: a list the tools page reads drifting from the engine)`, () => {
      expect(exported).toEqual([...copy]);
    });
  }
  for (const name of NEXT_TYPES) {
    it.todo(`TODO(engine): ${name} holds the engine's export (game ${ENGINE_VERSION} has none)`);
  }
});

describe("the pass ring and the system names as perf reads them", () => {
  it("names a pass's filter kindNames[kind2 - 1] and kind2 0 none (bug: an off-by-one naming the wrong filter)", () => {
    const { monitor, tick, read } = feedRig({ feedPasses: true });
    monitor.commit({ t: 0 });
    monitor.commitPass({ kind: "filter", filter: "fog.blur", owner: 412 });
    monitor.commitPass({ kind: "filter", filter: "colorMatrix", owner: 412 });
    monitor.commitPass({ kind: "canvas" });
    tick();
    const wire = read("editor.perf.frames") as PerfFramesWire;
    // eslint-disable-next-line unicorn/no-null -- null is "no filter" on the wire
    expect(wire.passes?.filter).toEqual(["fog.blur", "colorMatrix", null]);
    // eslint-disable-next-line unicorn/no-null -- null is "no owner" on the wire
    expect(wire.passes?.owner).toEqual([412, 412, null]);
  });

  it.each([
    "copy",
    "in-place"
  ] as const)("copies the system names again only when the ring's names grow (%s) (bug: a newly registered system sent without its name, or the names copied at every read)", grow => {
    const { monitor, tick, read, state } = feedRig({}, { systemNames: grow });
    const ward = monitor.addSystem("ward.update");
    monitor.commit({ t: 0, systems: [{ idx: ward, ms: 1 }] });
    tick();
    const sent = state.systemNames;
    monitor.commit({ t: 16.7, gapMs: 16.7, systems: [{ idx: ward, ms: 1 }] });
    tick();
    expect(state.systemNames).toBe(sent);

    const fog = monitor.addSystem("fog.render");
    monitor.commit({ t: 33.4, gapMs: 16.7, systems: [{ idx: fog, ms: 2 }] });
    tick();
    expect(state.systemNames).not.toBe(sent);
    expect((read("editor.perf.frames") as PerfFramesWire).systems?.names).toEqual([
      "ward.update",
      "fog.render"
    ]);
  });
});
