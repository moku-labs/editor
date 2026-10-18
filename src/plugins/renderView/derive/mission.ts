/**
 * @file renderView derive — what Mission control shows, in one copy (spec 09 § M12 MissionView): the
 * source and its state, live or paused, the span and the selection, the frames header numbers (GCs
 * only while memory is measured and its section on), the rate, the Monitoring rows, the overdraw view,
 * memory and the recording. Pure over Mission control's state and what activeSource and link say.
 */
import { viewStats } from "../series/stats";
import type { SourceLabel } from "../source/contract";
import type { MissionState, MissionView } from "../types";
import { sourceView } from "./connection";
import type { MemoryInput } from "./memory";
import { memorySource, memoryView } from "./memory";
import { sectionsView } from "./monitoring";
import { rateView } from "./rate";
import { recordingView } from "./record";

/**
 * The Memory card's input of Mission control's state.
 *
 * @param mission - Mission control's state.
 * @returns The input (a device's heap comes from its telemetry only).
 * @example
 * ```ts
 * memoryView(memoryInputOf(mission)).source; // "cdp" on a wired phone
 * ```
 */
export function memoryInputOf(mission: MissionState): MemoryInput {
  return {
    second: mission.second,
    telemetry: mission.telemetry,
    series: mission.series,
    history: mission.history,
    device: mission.source?.kind === "device"
  };
}

/**
 * Whether the source has a heap to read (the Memory & GC row is not "not measured").
 *
 * @param mission - Mission control's state.
 * @returns Whether memory is measured.
 * @example
 * ```ts
 * memoryMeasured(mission); // false on an iPhone
 * ```
 */
export function memoryMeasured(mission: MissionState): boolean {
  return memorySource(memoryInputOf(mission)) !== "none";
}

/**
 * What the page shows, in copies: undefined without a source.
 *
 * @param mission - Mission control's state.
 * @param input - The source's label, whether its agent has a frame monitor, the view's end and how
 *   far it is behind live.
 * @param input.label - activeSource.label().
 * @param input.monitored - The manifest lists `editor.perf.second`.
 * @param input.endMs - The view's end now (source clock).
 * @param input.behindMs - How far the paused view is behind live; 0 live.
 * @returns The view.
 * @example
 * ```ts
 * missionView(mission, { label, monitored: true, endMs: 80_100, behindMs: 0 })?.source.name; // "Galaxy A26"
 * ```
 */
export function missionView(
  mission: MissionState,
  input: {
    readonly label: SourceLabel;
    readonly monitored: boolean;
    readonly endMs: number;
    readonly behindMs: number;
  }
): MissionView | undefined {
  const source = sourceView(mission.source, input.label, mission.second, input.monitored);
  if (source === undefined) return undefined;
  const { second, view } = mission;
  const measured = memoryMeasured(mission);
  const sections = sectionsView(second?.monitor, second?.caps, measured);
  const stats = viewStats(
    mission.history,
    input.endMs - view.span,
    input.endMs,
    mission.series.gcs
  );
  const gcsShown = measured && sections?.memory !== "off";
  return {
    source,
    live: view.live,
    behindMs: input.behindMs,
    span: view.span,
    selection: mission.selection === undefined ? undefined : { ...mission.selection },
    // eslint-disable-next-line unicorn/no-null -- null: GCs are not shown (memory off or not measured)
    stats: { ...stats, gcs: gcsShown ? stats.gcs : null },
    rate: rateView(second, mission.rate),
    sections,
    overdraw: second?.monitor?.overdraw ?? undefined,
    memory: memoryView(memoryInputOf(mission)),
    recording: recordingView(mission.recorder)
  };
}

/**
 * What the graphs draw of the source's sections (spec 09 § M8, honest limits): GC marks (on, off
 * with Memory & GC switched off, none without a memory source), GPU time (on, off, or not measured
 * without a timer) and the Shaders & passes lane (on unless switched off).
 *
 * @example
 * ```ts
 * const flags: GraphFlags = { gc: "none", gpu: "not-measured", passes: true }; // an iPhone
 * ```
 */
export type GraphFlags = {
  readonly gc: "on" | "off" | "none";
  readonly gpu: "on" | "off" | "not-measured";
  readonly passes: boolean;
};

/**
 * The graph flags of the source now.
 *
 * @param mission - Mission control's state.
 * @returns The flags.
 * @example
 * ```ts
 * graphFlags(mission).gc; // "off" after Memory & GC was switched off
 * ```
 */
export function graphFlags(mission: MissionState): GraphFlags {
  const { second } = mission;
  const measured = memoryMeasured(mission);
  const sections = sectionsView(second?.monitor, second?.caps, measured);
  let gc: GraphFlags["gc"] = "on";
  if (!measured) gc = "none";
  else if (sections?.memory === "off") gc = "off";
  let gpu: GraphFlags["gpu"] = mission.history.gpuTimer ? "on" : "not-measured";
  if (sections?.gpu === "off") gpu = "off";
  if (sections?.gpu === "unavailable" || second?.caps?.gpuTimer === false) gpu = "not-measured";
  return { gc, gpu, passes: sections?.passes !== "off" };
}
