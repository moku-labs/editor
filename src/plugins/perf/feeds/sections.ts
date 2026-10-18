/**
 * @file perf feeds — monitoring (spec 03 Delta 2026-10-16 D7): the engine's sections as last heard
 * (header, the read at start, `sections` lines, a write's answer), the `editor.perf.sections`
 * command that switches perf's own feeds and, on an engine with `monitor.sections`, the engine's
 * sections; and the Monitoring popover's state, also `second().monitor`.
 */
import type { Json } from "../../registry/protocol";
import { checkInput, errorCode, wireError } from "../../registry/protocol";
import type { MonitorSectionName, MonitorSections, PerfMonitorState } from "../protocol";
import { isSectionsDetail, MONITOR_SECTIONS, SECTION_DEFAULTS } from "../protocol";
import { notifyInSpan } from "../state";
import type { PerfState, TimelineLine } from "../types";
import { MS_SCALE, measured } from "./wire";

/** The input of `editor.perf.sections`: any subset of the sections, `{}` reads. */
export const SECTIONS_INPUT = {
  gpu: "boolean?",
  passes: "boolean?",
  shaders: "boolean?",
  problems: "boolean?",
  memory: "boolean?",
  systems: "boolean?",
  nodes: "boolean?",
  longFrames: "boolean?"
} as const;

/**
 * Calls the monitor's `sections` (next change) inside the agent span; undefined on an engine
 * without it.
 *
 * @param state - perf's state.
 * @param next - The sections to switch; undefined to read.
 * @returns The engine's sections, or undefined.
 * @throws {Error} What the engine's `sections` throws (its control refusal for a write).
 */
function callSections(
  state: PerfState,
  next?: Partial<MonitorSections>
): MonitorSections | undefined {
  const { monitor } = state;
  if (typeof monitor?.sections !== "function") return undefined;
  monitor.beginAgent();
  try {
    return monitor.sections(next);
  } finally {
    monitor.endAgent();
  }
}

/**
 * onStart: reads the engine's sections once, when the engine has `monitor.sections` (next change);
 * a read that throws keeps what the header said.
 *
 * @param state - perf's state.
 */
export function readSections(state: PerfState): void {
  try {
    state.sections = callSections(state) ?? state.sections;
  } catch {
    // A read the engine refuses or breaks on: keep the header's sections.
  }
}

/**
 * Applies a `sections` line (N1) to the sections as last heard: its `on` names switched on, its
 * `off` names off, on top of the header's (else the defaults). A line of another shape changes
 * nothing.
 *
 * @param state - perf's state.
 * @param line - A `sections` event line.
 */
export function noteSections(state: PerfState, line: TimelineLine): void {
  if (line.kind !== "event" || !isSectionsDetail(line.detail)) return;
  const sections: Record<MonitorSectionName, boolean> = { ...(state.sections ?? SECTION_DEFAULTS) };
  for (const name of MONITOR_SECTIONS) {
    if (line.detail.on.includes(name)) sections[name] = true;
    if (line.detail.off.includes(name)) sections[name] = false;
  }
  state.sections = sections;
  state.second = undefined;
}

/**
 * The Monitoring popover's state (D7), also `second().monitor`: the engine's sections when it can
 * switch them (else the defaults, `engine: false`), perf's feeds, the cost per section and the
 * monitor's cost from the newest sample, perf's own read time, and the overdraw heat map.
 *
 * @param state - perf's state.
 * @returns The state (a fresh object).
 */
export function monitorStateOf(state: PerfState): PerfMonitorState {
  const engine = typeof state.monitor?.sections === "function";
  const costs = state.sample?.sectionsMs;
  return {
    engine,
    sections: { ...(state.sections ?? SECTION_DEFAULTS) },
    feeds: { ...state.feeds },
    // eslint-disable-next-line unicorn/no-null -- null is "the engine sends no cost per section"
    costMs: costs === undefined ? null : { ...costs },
    monitorMs: measured(state.sample?.monitorMs, MS_SCALE),
    editorMs: measured(state.editorMs, MS_SCALE),
    overdraw: state.overdraw
  };
}

/**
 * The engine's control refusal of an error (TC §3): its `reason` tag, `"read-only"` or
 * `"dev-only"`; undefined for any other error.
 *
 * @param error - What the engine threw.
 * @returns The tag, or undefined.
 */
function refusalOf(error: unknown): "read-only" | "dev-only" | undefined {
  const reason: unknown =
    typeof error === "object" && error !== null ? Reflect.get(error, "reason") : undefined;
  return reason === "read-only" || reason === "dev-only" ? reason : undefined;
}

/**
 * `editor.perf.sections` (D7): checks the input (-32602 for a key that is not a boolean), switches
 * perf's feeds for `passes`, `systems` and `nodes` (a switch-on of `passes` reads from the ring's
 * oldest held pass), then, on an engine with `monitor.sections` and a non-empty input, writes the
 * engine's sections inside the agent span and keeps its answer. The engine's control refusal is
 * the registry's -32009 (`read_only` / `dev_only`), after the feeds switched. Notifies the watches.
 *
 * @param state - perf's state.
 * @param raw - The command's raw input.
 * @returns The Monitoring state.
 * @throws {Error} -32602 for a bad input; -32009 when the build refuses the engine's switch.
 */
export function runSections(state: PerfState, raw: Json): PerfMonitorState {
  const input = checkInput(SECTIONS_INPUT, raw);
  const { feeds } = state;
  if (input.passes === true && !feeds.passes) {
    state.passCursor = undefined;
    state.passes.count = 0;
  }
  feeds.passes = input.passes ?? feeds.passes;
  feeds.systems = input.systems ?? feeds.systems;
  feeds.nodes = input.nodes ?? feeds.nodes;
  const next: Partial<Record<MonitorSectionName, boolean>> = {};
  for (const name of MONITOR_SECTIONS) {
    const value = input[name];
    if (value !== undefined) next[name] = value;
  }
  try {
    if (Object.keys(next).length > 0) state.sections = callSections(state, next) ?? state.sections;
  } catch (error) {
    const refusal = refusalOf(error);
    if (refusal === undefined) throw error;
    const readOnly = refusal === "read-only";
    throw wireError(
      readOnly ? errorCode.readOnly : errorCode.devOnly,
      `editor.perf.sections: this build cannot switch the engine's sections (${refusal}); perf's own feeds switched.\n  Build the game with moku-game build --debug to switch them.`,
      { reason: readOnly ? "read_only" : "dev_only", retryable: false }
    );
  } finally {
    notifyInSpan(state);
  }
  return monitorStateOf(state);
}
