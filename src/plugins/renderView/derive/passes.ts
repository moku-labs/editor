/**
 * @file renderView derive — the Shaders & passes panel (spec 09 § M9): the heaviest frame's passes as
 * rows (a filter chain of one owner is one row: "fogLayer → blur → colorMatrix"), their GPU (a tile
 * GPU shows its share of the frame, never ms per pass), the shader chips (WebGPU "variants", WebGL
 * "re-links"), compiles inside a frame (boot compiles only counted), and the active problems with
 * their sentences. Pure.
 */
import { rowOfFrame } from "../series/rows";
import type {
  PassChainSummary,
  PassRowWire,
  PerfHistory,
  PerfPassesSummary,
  PerfTimelineEvent
} from "../source/contract";
import { REST, spikeCause } from "../source/contract";
import { DASH, oneDecimal } from "./words";

/** A problem event of the timeline. */
type Problem = Extract<PerfTimelineEvent, { kind: "problem" }>;

/** A shader event of the timeline. */
type Shader = Extract<PerfTimelineEvent, { kind: "shader" }>;

/**
 * A pass's GPU cell: its share ("≈ 52 %") on a tile GPU, its ms elsewhere, "—" when not measured.
 *
 * @param pass - A pass of the heaviest frame.
 * @param tiler - The GPU is a tile GPU.
 * @returns The text.
 * @example
 * ```ts
 * passCellText(pass, true); // "≈ 52 %"
 * ```
 */
export function passCellText(pass: PassRowWire, tiler: boolean): string {
  if (tiler) return pass.share === null ? DASH : `≈ ${Math.round(pass.share * 100)} %`;
  return pass.gpuMs === null ? DASH : `${oneDecimal(pass.gpuMs)} ms`;
}

/**
 * One row of "Passes per frame".
 *
 * @example
 * ```ts
 * const row: PassPanelRow = { key: "1", view: "fogLayer", label: "fogLayer", chain: "fogLayer → fog.blur → fog.blur",
 *   target: "1280×720 rgba16float, 4 draws", gpu: "6.2 ms", spikes: "13.8 in GPU spikes" };
 * ```
 */
export type PassPanelRow = {
  readonly key: string;
  /** The view whose lane colour the row's square takes. */
  readonly view: string;
  readonly label: string;
  readonly chain: string;
  readonly target: string;
  readonly gpu: string;
  /** "{max} in GPU spikes" when the chain's max is above twice its p50. */
  readonly spikes: string | undefined;
};

/**
 * Whether pass `next` continues the filter chain of `pass` (one owner, or without owners one view).
 *
 * @param pass - A filter pass.
 * @param next - The pass after it.
 * @returns Whether it belongs to the chain.
 */
function sameChain(pass: PassRowWire, next: PassRowWire | undefined): boolean {
  if (next?.kind !== "filter") return false;
  if (pass.owner !== null || next.owner !== null) return pass.owner === next.owner;
  return pass.view === next.view;
}

/**
 * The chain summary of a group of passes: the summary with the same view and kinds.
 *
 * @param chains - The second's chains.
 * @param view - The group's view.
 * @param kinds - Its filter names.
 * @returns The chain; undefined when none matches.
 */
function chainOf(
  chains: readonly PassChainSummary[],
  view: string | null | undefined,
  kinds: readonly string[]
): PassChainSummary | undefined {
  return chains.find(
    chain =>
      chain.view === view &&
      chain.kinds.length === kinds.length &&
      chain.kinds.every((kind, index) => kind === kinds[index])
  );
}

/**
 * The target words of a pass: "{w}×{h} {format}, {draws} draws".
 *
 * @param pass - The pass.
 * @param draws - The draws of its group; undefined when not counted.
 * @returns The words.
 */
function targetText(pass: PassRowWire, draws: number | undefined): string {
  const format = pass.format === null ? "" : ` ${pass.format}`;
  const counted = draws === undefined ? "draws not counted on WebGL" : `${draws} draws`;
  return `${pass.w}×${pass.h}${format}, ${counted}`;
}

/**
 * The GPU words of a group: its share on a tile GPU, else its ms.
 *
 * @param group - The passes.
 * @param tiler - A tile GPU.
 * @returns The words.
 */
function groupGpu(group: readonly PassRowWire[], tiler: boolean): string {
  let ms = 0;
  let share = 0;
  let measured = false;
  for (const pass of group) {
    if (pass.gpuMs !== null) {
      ms += pass.gpuMs;
      measured = true;
    }
    share += pass.share ?? 0;
  }
  if (!measured) return DASH;
  return tiler ? `≈ ${Math.round(share * 100)} %` : `${oneDecimal(ms)} ms`;
}

/**
 * One row of the panel from a group of passes.
 *
 * @param group - The passes (one, or a filter chain).
 * @param summary - The second's summary.
 * @returns The row.
 */
function rowOfGroup(group: readonly PassRowWire[], summary: PerfPassesSummary): PassPanelRow {
  const first = group[0];
  const view = first?.view ?? first?.kind ?? "";
  const kinds = group.filter(pass => pass.kind === "filter").map(pass => pass.filter ?? "filter");
  const chain = kinds.length === 0 ? undefined : chainOf(summary.chains, first?.view, kinds);
  let draws: number | undefined = 0;
  for (const pass of group) {
    draws = pass.draws === null || draws === undefined ? undefined : draws + pass.draws;
  }
  const max = chain?.gpuMs?.max ?? 0;
  const p50 = chain?.gpuMs?.p50 ?? 0;
  return {
    key: String(first?.index ?? 0),
    view,
    label: view,
    chain: kinds.length === 0 ? view : [view, ...kinds].join(" → "),
    target: first === undefined ? "" : targetText(first, draws),
    gpu: groupGpu(group, summary.tiler),
    spikes:
      chain !== undefined && max > 2 * p50 && !summary.tiler
        ? `${oneDecimal(max)} in GPU spikes`
        : undefined
  };
}

/**
 * The "Passes per frame" rows: the heaviest frame's passes in order, a filter chain of one owner as
 * one row.
 *
 * @param summary - The second's passes summary.
 * @returns The rows; empty without a heaviest frame.
 * @example
 * ```ts
 * passRows(summary).map(row => row.chain); // ["main", "fogLayer → fog.blur → fog.blur", "hud"]
 * ```
 */
export function passRows(summary: PerfPassesSummary): PassPanelRow[] {
  const passes = summary.heaviest?.passes ?? [];
  const rows: PassPanelRow[] = [];
  let index = 0;
  while (index < passes.length) {
    const group: PassRowWire[] = [];
    let pass = passes[index];
    while (pass !== undefined) {
      group.push(pass);
      index += 1;
      const next = passes[index];
      if (pass.kind !== "filter" || !sameChain(pass, next)) break;
      pass = next;
    }
    rows.push(rowOfGroup(group, summary));
  }
  return rows;
}

/**
 * The shader chips: "{pipelines} programs", "{variants} variants" on WebGPU or "{relinks} re-links"
 * on WebGL, "{hits} of {calls} cache hits". Shown only when the engine sends its counters (N7).
 *
 * @param summary - The second's passes summary.
 * @param backend - The page's GPU backend.
 * @returns The chips; empty without counters.
 * @example
 * ```ts
 * shaderChips(summary, "webgpu"); // ["14 programs", "3 variants", "92 of 106 cache hits"]
 * ```
 */
export function shaderChips(
  summary: PerfPassesSummary | undefined,
  backend: "webgpu" | "webgl" | "none" | undefined
): string[] {
  const shaders = summary?.shaders;
  if (shaders === null || shaders === undefined) return [];
  const second =
    backend === "webgpu" ? `${shaders.variants} variants` : `${shaders.relinks} re-links`;
  return [
    `${shaders.pipelines} programs`,
    second,
    `${shaders.hits} of ${shaders.hits + shaders.compiles} cache hits`
  ];
}

/**
 * A compile inside a frame, as the panel lists it.
 *
 * @example
 * ```ts
 * const row: CompilePanelRow = { frame: 4851, label: "fog.blur", sub: "f4851, by fogLayer, a spike", ms: "31 ms" };
 * ```
 */
export type CompilePanelRow = {
  readonly frame: number;
  readonly label: string;
  readonly sub: string;
  readonly ms: string;
};

/**
 * "Compiled inside a frame": the non-boot compiles of the history with "f{frame}, by {view}" and ", a
 * spike" when their frame is one; the boot compiles counted in the note.
 *
 * @param history - The history.
 * @returns The rows and the note; the note undefined without any compile.
 * @example
 * ```ts
 * compilesOf(history).note; // "38 others compiled while loading, before the first frame."
 * ```
 */
export function compilesOf(history: PerfHistory): {
  readonly rows: readonly CompilePanelRow[];
  readonly note: string | undefined;
} {
  const rows: CompilePanelRow[] = [];
  let boot = 0;
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "shader") continue;
    if (event.boot) {
      boot += 1;
      continue;
    }
    rows.push(compileRow(history, event));
  }
  let note: string | undefined;
  if (rows.length > 0 && boot > 0)
    note = `${boot} others compiled while loading, before the first frame.`;
  if (rows.length === 0 && boot > 0)
    note = `All ${boot} compiled while loading. No compile inside a frame so far.`;
  return { rows, note };
}

/**
 * One compile row.
 *
 * @param history - The history.
 * @param event - The compile.
 * @returns The row.
 */
function compileRow(history: PerfHistory, event: Shader): CompilePanelRow {
  const row = rowOfFrame(history, event.frame);
  const spike = row >= 0 && spikeCause(history.causes[row] ?? 0, history.rest[row] ?? 0) > 0;
  const by = event.view === null ? "" : `, by ${event.view}`;
  return {
    frame: event.frame,
    label: event.label ?? event.what,
    sub: `f${event.frame}${by}${spike ? ", a spike" : ""}`,
    ms: event.ms === null ? DASH : `${oneDecimal(event.ms)} ms`
  };
}

/**
 * The active problems: the history's `problem` events not yet cleared, matched by rule, owner and
 * view (two views on one rule clear independently), the newest of each.
 *
 * @param history - The history.
 * @returns The problems, oldest first.
 * @example
 * ```ts
 * activeProblems(history).map(problem => problem.rule); // ["filter-still"]
 * ```
 */
export function activeProblems(history: PerfHistory): Problem[] {
  const active = new Map<string, Problem>();
  for (let index = 0; index < history.eventCount; index += 1) {
    const event = history.events[index];
    if (event?.kind !== "problem") continue;
    const key = `${event.rule}\u0000${event.owner ?? ""}\u0000${event.view ?? ""}`;
    if (event.cleared) active.delete(key);
    else active.set(key, event);
  }
  return [...active.values()];
}

/**
 * The sentence of a problem by its rule; an unknown rule shows its name and value.
 *
 * @param problem - The problem.
 * @returns The sentence.
 */
function problemSentence(problem: Problem): string {
  const view = problem.view ?? "a view";
  const filter = problem.filter ?? "a filter";
  const value = problem.value === null ? "" : oneDecimal(problem.value);
  switch (problem.rule) {
    case "filter-still": {
      return `${filter} on ${view} re-runs every frame while it is still — cache it`;
    }
    case "filter-area": {
      return `${filter} on ${view} covers ${value}× the canvas`;
    }
    case "target-churn": {
      return `offscreen targets: ${value} created / s`;
    }
    case "retakes": {
      return `${view} retook its kept picture ${value} times / s`;
    }
    case "late-compile": {
      return `${view} compiled after the first frame, outside a warm-up`;
    }
    case "variants": {
      return `${view} has ${value} pipeline variants`;
    }
    case "pass-budget": {
      return `${value} passes in a frame, over ${problem.threshold ?? ""}`;
    }
    default: {
      return value === "" ? problem.rule : `${problem.rule}: ${value}`;
    }
  }
}

/**
 * Whether a frame lies in a resting run.
 *
 * @param history - The history.
 * @param frame - The frame.
 * @returns Whether it rested.
 */
function restedAt(history: PerfHistory, frame: number | null): boolean {
  if (frame === null) return false;
  const row = rowOfFrame(history, frame);
  return row >= 0 && history.rest[row] === REST.idle;
}

/**
 * An Issues row: the rule's sentence and its sub line (filter-still's reason, "also while the game
 * rests" when it started in a rest).
 *
 * @param problem - An active problem.
 * @param history - The history (where `since` lies).
 * @returns The sentence and the sub line.
 * @example
 * ```ts
 * problemText(problem, history); // { text: "fog.blur on fogLayer re-runs every frame while it is still — cache it", sub: "its kept picture was refused, over the budget" }
 * ```
 */
export function problemText(
  problem: Problem,
  history: PerfHistory
): { readonly text: string; readonly sub: string } {
  const parts: string[] = [];
  if (problem.reason === "budget") parts.push("its kept picture was refused, over the budget");
  if (problem.reason === "not-eligible") parts.push("not eligible for a kept picture");
  if (restedAt(history, problem.since)) parts.push("also while the game rests");
  return { text: problemSentence(problem), sub: parts.join("; ") };
}
