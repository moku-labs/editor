/**
 * @file renderView source — the ids Mission control reads on the active source (spec 09 § M2) and
 * the values they answer, named once.
 */
import type {
  DeviceTelemetry,
  PerfDetailWire,
  PerfEventsWire,
  PerfFramesWire,
  PerfMonitorState,
  PerfPassesWire,
  PerfSecond,
  RecorderSource
} from "./contract";

/**
 * A source Mission control watches or reads on the active session (spec 09 § M2).
 *
 * @example
 * ```ts
 * const id: MissionSourceId = "editor.perf.frames";
 * ```
 */
export type MissionSourceId =
  | "editor.perf.second"
  | "editor.perf.frames"
  | "editor.perf.events"
  | "editor.perf.passes"
  | "editor.perf.detail"
  | "editor.recorder";

/**
 * A command Mission control runs on the active session (spec 09 § M0: the only ones Render sends).
 *
 * @example
 * ```ts
 * const id: MissionCommandId = "game.frameRate";
 * ```
 */
export type MissionCommandId =
  | "game.frameRate"
  | "editor.perf.sections"
  | "game.debug"
  | "editor.record";

/**
 * The value each source answers, by id.
 *
 * @example
 * ```ts
 * type Second = MissionValues["editor.perf.second"]; // PerfSecond
 * ```
 */
export type MissionValues = {
  readonly "editor.perf.second": PerfSecond;
  readonly "editor.perf.frames": PerfFramesWire;
  readonly "editor.perf.events": PerfEventsWire;
  /** null before the agent's first full second. */
  readonly "editor.perf.passes": PerfPassesWire | null;
  readonly "editor.perf.detail": PerfDetailWire;
  readonly "editor.recorder": RecorderSource;
};

/**
 * What `editor.perf.sections` answers: the Monitoring popover's state.
 *
 * @example
 * ```ts
 * const answer: SectionsValue = { engine: false, sections: SECTION_DEFAULTS, feeds: { passes: false, systems: true, nodes: false },
 *   costMs: null, monitorMs: 0.21, editorMs: 0.12, overdraw: null };
 * ```
 */
export type SectionsValue = PerfMonitorState;

/**
 * A wired telemetry record as Mission control keeps it.
 *
 * @example
 * ```ts
 * const record: TelemetryValue | undefined = app.activeSource.telemetry();
 * ```
 */
export type TelemetryValue = DeviceTelemetry;
