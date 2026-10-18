/**
 * @file renderView derive — the Monitoring popover (spec 09 § M7): each row's state (on, off,
 * unavailable: a newer engine needed, not measured on this device), its switch (none for Frames and
 * Render stats, disabled without control), its cost, the totals of the footer and the button, and the
 * exact `editor.perf.sections` keys a row sends (Systems timing → systems, Nodes → nodes, Shaders &
 * passes → passes + shaders). Pure.
 */
import type { Json } from "../../registry/protocol";
import type { MonitorSectionName, PerfCaps, PerfMonitorState } from "../source/contract";
import { MONITOR_SECTIONS, SECTION_DEFAULTS } from "../source/contract";
import type { MissionView, MonitorSection, SectionsAnswer } from "../types";
import { messageOf, reasonOf } from "./words";

/** The words of a switch that a build without control refuses (spec 09 § M7). */
export const NEEDS_DEBUG = "Needs a debug build to change what is monitored.";

/** A row's state. */
export type SectionState = "on" | "off" | "unavailable";

/** Every row's state. */
export type SectionStates = Readonly<Record<MonitorSection, SectionState>>;

/** One row of the Monitoring popover as the spec's table gives it. */
type RowSpec = {
  readonly section: MonitorSection;
  readonly title: string;
  readonly description: string;
  /** The `editor.perf.sections` keys the row switches; empty: always on. */
  readonly keys: readonly MonitorSectionName[];
  /** The cost of a row without keys. */
  readonly fixedCost?: string;
  /** The Nodes sub-row of Systems timing. */
  readonly nested?: true;
};

/** The rows, in the popover's order (spec 09 § M7 Monitoring popover). */
const ROWS: readonly RowSpec[] = [
  {
    section: "frames",
    title: "Frames",
    description: "Frame bars, spikes, frame time",
    keys: [],
    fixedCost: "base"
  },
  {
    section: "gpu",
    title: "GPU timing",
    description: "GPU part of each frame, GPU spikes",
    keys: ["gpu"]
  },
  {
    section: "memory",
    title: "Memory & GC",
    description: "Heap over time, GC marks, leak trend",
    keys: ["memory"]
  },
  {
    section: "render",
    title: "Render stats",
    description: "Draw calls, textures, scene",
    keys: [],
    fixedCost: "light"
  },
  {
    section: "systems",
    title: "Systems timing",
    description: "What ran: the 5 slowest systems per frame",
    keys: ["systems"]
  },
  {
    section: "nodes",
    title: "Nodes",
    description: "Scene nodes updated or redrawn, in a range",
    keys: ["nodes"],
    nested: true
  },
  {
    section: "passes",
    title: "Shaders & passes",
    description: "Render passes per frame, filters, shader compiles, problems",
    keys: ["passes", "shaders"]
  }
];

/**
 * One row as the popover shows it.
 *
 * @example
 * ```ts
 * const row: MonitorRow = { section: "gpu", title: "GPU timing", description: "GPU part of each frame, GPU spikes", nested: false,
 *   state: "unavailable", switchable: false, note: "needs a newer engine", cost: { text: "cost not measured", tone: "muted" } };
 * ```
 */
export type MonitorRow = {
  readonly section: MonitorSection;
  readonly title: string;
  readonly description: string;
  readonly nested: boolean;
  readonly state: SectionState;
  /** The row has a switch the person can flip now. */
  readonly switchable: boolean;
  /** Why the switch is missing or disabled: "always on", "needs a newer engine", … */
  readonly note: string | undefined;
  readonly cost: { readonly text: string; readonly tone: "live" | "plain" | "warn" | "muted" };
};

/**
 * The `editor.perf.sections` keys a row switches.
 *
 * @param section - A Monitoring row.
 * @returns The keys; undefined for a row that is always on (frames, render).
 * @example
 * ```ts
 * sectionKeys("passes"); // ["passes", "shaders"]
 * ```
 */
export function sectionKeys(section: MonitorSection): readonly MonitorSectionName[] | undefined {
  const keys = ROWS.find(row => row.section === section)?.keys ?? [];
  return keys.length === 0 ? undefined : keys;
}

/**
 * The input of `editor.perf.sections` for a row: exactly its keys, set on or off.
 *
 * @param section - A Monitoring row.
 * @param on - On or off.
 * @returns The input; undefined for a row that is always on.
 * @example
 * ```ts
 * sectionsInput("nodes", true); // { nodes: true }
 * ```
 */
export function sectionsInput(section: MonitorSection, on: boolean): Json | undefined {
  const keys = sectionKeys(section);
  if (keys === undefined) return undefined;
  const input: Record<string, Json> = {};
  for (const key of keys) input[key] = on;
  return input;
}

/**
 * Whether a feed row is on: perf's feed, and the engine's section when the engine can switch it.
 *
 * @param monitor - The monitoring state.
 * @param section - A feed row.
 * @returns Whether it collects.
 */
function feedOn(monitor: PerfMonitorState, section: "systems" | "nodes" | "passes"): boolean {
  return monitor.feeds[section] && (!monitor.engine || monitor.sections[section]);
}

/**
 * Why an engine row cannot be switched, if it cannot.
 *
 * @param monitor - The monitoring state.
 * @param caps - What the engine measures.
 * @param section - "gpu" or "memory".
 * @param memoryMeasured - The source has a heap to read.
 * @returns "needs a newer engine", "not measured on this device", or undefined.
 */
function unavailableWhy(
  monitor: PerfMonitorState,
  caps: PerfCaps | undefined,
  section: "gpu" | "memory",
  memoryMeasured: boolean
): string | undefined {
  if (!monitor.engine) return "needs a newer engine";
  if (section === "gpu" && caps?.gpuTimer === false) return "not measured on this device";
  if (section === "memory" && !memoryMeasured) return "not measured on this device";
  return undefined;
}

/**
 * The state of one row.
 *
 * @param monitor - The monitoring state.
 * @param caps - What the engine measures.
 * @param section - The row.
 * @param memoryMeasured - The source has a heap to read.
 * @returns on, off or unavailable.
 */
function stateOf(
  monitor: PerfMonitorState,
  caps: PerfCaps | undefined,
  section: MonitorSection,
  memoryMeasured: boolean
): SectionState {
  if (section === "frames" || section === "render") return "on";
  if (section === "gpu" || section === "memory") {
    if (unavailableWhy(monitor, caps, section, memoryMeasured) !== undefined) return "unavailable";
    return monitor.sections[section] ? "on" : "off";
  }
  return feedOn(monitor, section) ? "on" : "off";
}

/**
 * Every row's state: on, off, or unavailable (an engine before `monitor.sections` for GPU timing and
 * Memory & GC, no GPU timer, no memory source).
 *
 * @param monitor - second.monitor.
 * @param caps - second.caps.
 * @param memoryMeasured - The source has a heap to read (a trusted page heap, a shell's memory, or a
 *   wired phone's CDP heap).
 * @returns The rows; undefined before the first second with monitoring.
 * @example
 * ```ts
 * sectionsView(second.monitor, second.caps, true)?.passes; // "off": the engine's default
 * ```
 */
export function sectionsView(
  monitor: PerfMonitorState | undefined,
  caps: PerfCaps | undefined,
  memoryMeasured: boolean
): MissionView["sections"] {
  if (monitor === undefined) return undefined;
  return {
    frames: "on",
    gpu: stateOf(monitor, caps, "gpu", memoryMeasured),
    memory: stateOf(monitor, caps, "memory", memoryMeasured),
    render: "on",
    systems: stateOf(monitor, caps, "systems", memoryMeasured),
    nodes: stateOf(monitor, caps, "nodes", memoryMeasured),
    passes: stateOf(monitor, caps, "passes", memoryMeasured)
  };
}

/**
 * A measured cost in words: under 0.02 ms "light", else "adds ~{x} ms/frame" (two significant
 * digits); not measured "cost not measured".
 *
 * @param ms - The cost per drawn frame; undefined or null when not measured.
 * @returns The words and their tone.
 * @example
 * ```ts
 * costText(0.15); // { text: "adds ~0.15 ms/frame", tone: "plain" }
 * ```
 */
export function costText(ms: number | null | undefined): MonitorRow["cost"] {
  if (ms === null || ms === undefined) return { text: "cost not measured", tone: "muted" };
  if (ms < 0.02) return { text: "light", tone: "live" };
  return { text: `adds ~${Number(ms.toPrecision(2))} ms/frame`, tone: "plain" };
}

/**
 * The cost of a row's keys: their sum, undefined when one is not measured.
 *
 * @param monitor - The monitoring state.
 * @param keys - The row's keys.
 * @returns ms per frame.
 */
function keysCost(
  monitor: PerfMonitorState,
  keys: readonly MonitorSectionName[]
): number | undefined {
  if (monitor.costMs === null) return undefined;
  let total = 0;
  for (const key of keys) {
    const cost = monitor.costMs[key];
    if (cost === undefined) return undefined;
    total += cost;
  }
  return total;
}

/**
 * The cost cell of a row.
 *
 * @param monitor - The monitoring state.
 * @param spec - The row.
 * @param note - Why it is unavailable, if it is.
 * @returns The cost.
 */
function rowCost(
  monitor: PerfMonitorState,
  spec: RowSpec,
  note: string | undefined
): MonitorRow["cost"] {
  if (spec.fixedCost !== undefined) {
    return { text: spec.fixedCost, tone: spec.fixedCost === "light" ? "live" : "plain" };
  }
  if (note !== undefined) return { text: note, tone: "muted" };
  return costText(keysCost(monitor, spec.keys));
}

/**
 * The rows of the Monitoring popover: their state, switch, note and cost. Frames and Render stats
 * have no switch ("always on"); an engine without `monitor.sections` leaves only the perf feeds
 * (systems, nodes, passes) switchable and shows GPU timing and Memory & GC "needs a newer engine";
 * without control every switch is disabled with NEEDS_DEBUG.
 *
 * @param input - The monitoring state, the capabilities, the memory source and control.
 * @param input.monitor - second.monitor.
 * @param input.caps - second.caps.
 * @param input.memoryMeasured - The source has a heap to read.
 * @param input.control - The source's build runs `editor.perf.sections` (its manifest allows it).
 * @returns The rows, in order.
 * @example
 * ```ts
 * monitoringRows({ monitor, caps, memoryMeasured: true, control: true }).map(row => row.title);
 * // ["Frames", "GPU timing", "Memory & GC", "Render stats", "Systems timing", "Nodes", "Shaders & passes"]
 * ```
 */
export function monitoringRows(input: {
  readonly monitor: PerfMonitorState;
  readonly caps: PerfCaps | undefined;
  readonly memoryMeasured: boolean;
  readonly control: boolean;
}): MonitorRow[] {
  const { monitor, caps, memoryMeasured, control } = input;
  return ROWS.map(spec => {
    const { section } = spec;
    const engineRow = section === "gpu" || section === "memory";
    const why = engineRow ? unavailableWhy(monitor, caps, section, memoryMeasured) : undefined;
    const fixed = spec.keys.length === 0;
    let note: string | undefined = why;
    if (fixed) note = "always on";
    else if (why === undefined && !control) note = NEEDS_DEBUG;
    return {
      section,
      title: spec.title,
      description: spec.description,
      nested: spec.nested === true,
      state: stateOf(monitor, caps, section, memoryMeasured),
      switchable: !fixed && why === undefined && control,
      note,
      cost: rowCost(monitor, spec, why)
    };
  });
}

/**
 * Whether a section collects now (the engine's section, and perf's feed for its feed sections).
 *
 * @param monitor - The monitoring state.
 * @param name - The section.
 * @returns Whether it is on.
 */
function sectionOn(monitor: PerfMonitorState, name: MonitorSectionName): boolean {
  if (name === "passes" || name === "systems" || name === "nodes") return feedOn(monitor, name);
  return monitor.sections[name];
}

/**
 * The totals of the popover's footer and the Monitoring button.
 *
 * @example
 * ```ts
 * const totals: MonitoringTotals = { on: 4, costMs: 0.8, button: "4 on, ~0.8 ms",
 *   footer: "Cost on the game: ~0.8 ms/frame, 5 % of the 16.7 ms frame budget.", meter: 38.3,
 *   note: "A section that is off stops collecting on the device, and its cards say so.", editor: "The editor's own reading: ~0.1 ms a second" };
 * ```
 */
export type MonitoringTotals = {
  /** Switchable rows on. */
  readonly on: number;
  /** The summed cost of the sections on; null when the engine does not measure it. */
  readonly costMs: number | null;
  readonly button: string;
  readonly footer: string;
  /** The meter's width, % (pct × 8, at most 100); null without a cost. */
  readonly meter: number | null;
  readonly note: string;
  /** "The editor's own reading: ~{editorMs} ms a second"; undefined when not known. */
  readonly editor: string | undefined;
};

/**
 * The totals: switchable rows on, the summed `costMs` of the sections on (one decimal), the footer
 * "Cost on the game: ~{total} ms/frame, {pct} % of the {budget} ms frame budget." with a meter of
 * pct × 8 (at most 100), or "Cost on the game is not measured by this engine." without a cost.
 *
 * @param monitor - The monitoring state.
 * @param rows - The popover's rows.
 * @param budgetMs - The frame budget (second.budgetMs).
 * @param device - The source is a device ("on the device"; the local preview "on the game").
 * @returns The totals.
 * @example
 * ```ts
 * monitoringTotals(monitor, rows, 16.7, true).button; // "4 on, ~0.8 ms"
 * ```
 */
export function monitoringTotals(
  monitor: PerfMonitorState,
  rows: readonly MonitorRow[],
  budgetMs: number,
  device: boolean
): MonitoringTotals {
  const on = rows.filter(row => row.note !== "always on" && row.state === "on").length;
  const note = `A section that is off stops collecting ${device ? "on the device" : "on the game"}, and its cards say so.`;
  const editor =
    monitor.editorMs === null
      ? undefined
      : `The editor's own reading: ~${Number(monitor.editorMs.toPrecision(2))} ms a second`;
  if (monitor.costMs === null) {
    return {
      on,
      // eslint-disable-next-line unicorn/no-null -- null: not measured by this engine
      costMs: null,
      button: `${on} on`,
      footer: "Cost on the game is not measured by this engine.",
      // eslint-disable-next-line unicorn/no-null -- null: no meter without a cost
      meter: null,
      note,
      editor
    };
  }
  let total = 0;
  for (const name of MONITOR_SECTIONS) {
    if (sectionOn(monitor, name)) total += monitor.costMs[name] ?? 0;
  }
  const costMs = Math.round(total * 10) / 10;
  const pct = budgetMs > 0 ? (total / budgetMs) * 100 : 0;
  return {
    on,
    costMs,
    button: `${on} on, ~${costMs} ms`,
    footer: `Cost on the game: ~${costMs} ms/frame, ${Math.round(pct)} % of the ${Math.round(budgetMs * 10) / 10} ms frame budget.`,
    meter: Math.min(100, pct * 8),
    note,
    editor
  };
}

/**
 * The monitoring state of an `editor.perf.sections` answer (the truth the switches show).
 *
 * @param value - The answer's value.
 * @returns The state; undefined for another shape.
 * @example
 * ```ts
 * monitorStateOf(result.value)?.feeds.nodes; // true after Nodes was switched on
 * ```
 */
export function monitorStateOf(value: Json): PerfMonitorState | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  const { engine, sections, feeds, costMs, monitorMs, editorMs, overdraw } = value;
  if (typeof engine !== "boolean" || !isFlags(sections) || !isFlags(feeds)) return undefined;
  // eslint-disable-next-line unicorn/no-null -- null: not reported
  const none = null;
  return {
    engine,
    sections: { ...SECTION_DEFAULTS, ...sections },
    feeds: {
      passes: feeds.passes === true,
      systems: feeds.systems === true,
      nodes: feeds.nodes === true
    },
    costMs: isCosts(costMs) ? costMs : none,
    monitorMs: typeof monitorMs === "number" ? monitorMs : none,
    editorMs: typeof editorMs === "number" ? editorMs : none,
    overdraw: typeof overdraw === "boolean" ? overdraw : none
  };
}

/**
 * Whether a JSON value is an object of booleans (sections, feeds).
 *
 * @param value - The value.
 * @returns Whether it is one.
 */
function isFlags(value: Json | undefined): value is { readonly [key: string]: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(flag => typeof flag === "boolean")
  );
}

/**
 * Whether a JSON value is an object of costs.
 *
 * @param value - The value.
 * @returns Whether it is one.
 */
function isCosts(value: Json | undefined): value is { readonly [key: string]: number } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.values(value).every(cost => typeof cost === "number")
  );
}

/** The words of each row in an answer. */
const TITLES: Readonly<Record<MonitorSection, string>> = {
  frames: "Frames",
  gpu: "GPU timing",
  memory: "Memory & GC",
  render: "Render stats",
  systems: "Systems timing",
  nodes: "Nodes",
  passes: "Shaders & passes"
};

/**
 * The answer of a switch in words, with every row's state after it (the answer is the truth shown).
 *
 * @param section - The row that was switched.
 * @param value - The command's answer (PerfMonitorState).
 * @param caps - second.caps.
 * @param memoryMeasured - The source has a heap to read.
 * @returns The answer; `ok: false` for an answer of another shape.
 * @example
 * ```ts
 * sectionsAnswerOf("nodes", monitorState, caps, true).text; // "Nodes on"
 * ```
 */
export function sectionsAnswerOf(
  section: MonitorSection,
  value: Json,
  caps: PerfCaps | undefined,
  memoryMeasured: boolean
): SectionsAnswer {
  const monitor = monitorStateOf(value);
  if (monitor === undefined) {
    return {
      ok: false,
      text: "Refused: the answer is not a monitoring state",
      sections: undefined
    };
  }
  const sections = sectionsView(monitor, caps, memoryMeasured);
  return { ok: true, text: `${TITLES[section]} ${sections?.[section] ?? "off"}`, sections };
}

/**
 * A switch that did not run, in words: a build without control (`dev_only`, `read_only`) reads
 * NEEDS_DEBUG, no session "Not sent: no source connected", else "Refused: {message}".
 *
 * @param error - What the run rejected with.
 * @returns The answer.
 * @example
 * ```ts
 * sectionsRefusalOf(wireError(-32_009, "[moku-editor] read only", { reason: "read_only" })).text; // NEEDS_DEBUG
 * ```
 */
export function sectionsRefusalOf(error: unknown): SectionsAnswer {
  const reason = reasonOf(error);
  if (reason === "dev_only" || reason === "read_only") {
    return { ok: false, text: NEEDS_DEBUG, sections: undefined };
  }
  if (reason === "no_session") {
    return { ok: false, text: "Not sent: no source connected", sections: undefined };
  }
  return { ok: false, text: `Refused: ${messageOf(error)}`, sections: undefined };
}

/**
 * The answer of a row that is always on.
 *
 * @param section - "frames" or "render".
 * @returns "Frames are always measured" / "Render stats are always measured".
 * @example
 * ```ts
 * alwaysOn("frames").text; // "Frames are always measured"
 * ```
 */
export function alwaysOn(section: "frames" | "render"): SectionsAnswer {
  const text =
    section === "frames" ? "Frames are always measured" : "Render stats are always measured";
  return { ok: false, text, sections: undefined };
}
