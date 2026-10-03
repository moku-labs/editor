/* eslint-disable unicorn/no-null -- null is a JSON value */

import { readFileSync } from "node:fs";
import type { Json } from "../../registry/protocol";
import type { FlowJson, FlowViewConfig, GraphJson, HistoryEntryJson, Item } from "../types";
import raw from "./fixtures/merge-graph.json";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test data: the merge-game graph (flow.describe() of the fixture), the
// default config and small builders.
// ─────────────────────────────────────────────────────────────────────────────

/** The merge-game graph, as game.graph delivers it. */
export const mergeGraph: GraphJson = raw;

/** A deep copy of the merge-game graph. */
export function cloneGraph(): GraphJson {
  return structuredClone(mergeGraph);
}

/** One flow of the merge graph. */
export function flowOf(name: string, graph: GraphJson = mergeGraph): FlowJson {
  const flow = graph.flows[name];
  if (flow === undefined) throw new Error(`no flow ${name}`);
  return flow;
}

/** The default config of index.ts, with overrides. */
export function testConfig(overrides: Partial<FlowViewConfig> = {}): FlowViewConfig {
  return {
    historyLast: 20,
    trailLength: 6,
    rejectedOutcomes: ["rejected"],
    hubMinOutcomes: 6,
    hubMinReturns: 4,
    layoutFile: ".moku/editor/layout.json",
    notesDir: ".moku/notes",
    stylesFile: "features/ui/styles.ts",
    layoutWorker: false,
    layoutSaveDelayMs: 400,
    styleSaveDelayMs: 600,
    minZoom: 0.08,
    maxZoom: 3,
    defaultMinZoom: 0.8,
    ...overrides
  };
}

/** A history entry. */
export function entry(
  index: number,
  path: string,
  outcome: string,
  extra: { payload?: Json; next?: string; frame?: number } = {}
): HistoryEntryJson {
  const base: HistoryEntryJson = {
    index,
    path,
    outcome,
    payload: extra.payload ?? null,
    next: extra.next ?? "board/awaitIntent",
    now: 1_790_000_000_000 + index,
    hash: `h${index}`
  };
  return extra.frame === undefined ? base : { ...base, frame: extra.frame };
}

/** An item. */
export function item(overrides: Partial<Item> & { key: string }): Item {
  return {
    id: overrides.key,
    kind: "node",
    x: 0,
    y: 0,
    w: 172,
    h: 44,
    flow: "main",
    pinned: false,
    ...overrides
  };
}

/** The plugin folder, from the repository root (tests run there). */
export const PLUGIN_DIR = `${process.cwd()}/src/plugins/flowView/`;

/** The text of a fixture file. */
export function fixtureText(name: string): string {
  return readFileSync(`${PLUGIN_DIR}__tests__/fixtures/${name}`, "utf8");
}
