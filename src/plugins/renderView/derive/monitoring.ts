/**
 * @file renderView derive — the Monitoring popover (spec 09 § M7): each row's state and cost,
 * and the exact `editor.perf.sections` keys a row sends (Systems timing → systems, Nodes →
 * nodes, Shaders & passes → passes + shaders; Frames and Render stats are always on). Pure.
 * Typed stub of build wave 0 (spec 09 § M17, RV0): the signatures are the contract the other
 * Mission control units build against; build wave 3 (RV3) writes the bodies.
 */
import type { Json } from "../../registry/protocol";
import type { MonitorSectionName, PerfCaps, PerfMonitorState } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionView, MonitorSection, SectionsAnswer } from "../types";

/**
 * The `editor.perf.sections` keys a row switches.
 *
 * @param _section - A Monitoring row.
 * @returns The keys; undefined for a row that is always on (frames, render).
 * @throws {Error} Until build wave 3: "renderView derive/sectionKeys is not built yet".
 */
export function sectionKeys(_section: MonitorSection): readonly MonitorSectionName[] | undefined {
  return notBuilt("derive/sectionKeys", 3);
}

/**
 * Every row's state: on, off, or unavailable (needs a newer engine, no control, no memory
 * source).
 *
 * @param _monitor - second.monitor.
 * @param _caps - second.caps.
 * @returns The rows; undefined before the first second.
 * @throws {Error} Until build wave 3: "renderView derive/sectionsView is not built yet".
 */
export function sectionsView(
  _monitor: PerfMonitorState | undefined,
  _caps: PerfCaps | undefined
): MissionView["sections"] {
  return notBuilt("derive/sectionsView", 3);
}

/**
 * The answer of a switch in words, with every row's state after it.
 *
 * @param _section - The row that was switched.
 * @param _value - The command's answer (PerfMonitorState).
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView derive/sectionsAnswerOf is not built yet".
 */
export function sectionsAnswerOf(_section: MonitorSection, _value: Json): SectionsAnswer {
  return notBuilt("derive/sectionsAnswerOf", 3);
}

/**
 * A refused switch in words (dev-only, read-only, no session).
 *
 * @param _section - The row.
 * @param _error - What the run rejected with.
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView derive/sectionsRefusalOf is not built yet".
 */
export function sectionsRefusalOf(_section: MonitorSection, _error: unknown): SectionsAnswer {
  return notBuilt("derive/sectionsRefusalOf", 3);
}
