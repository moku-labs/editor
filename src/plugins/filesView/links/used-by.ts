/**
 * @file filesView plugin — Used by: the reverse map path → flows and nodes, over the protocol
 * rule `flowFile` / `nodeFile` (R1); its inputs: the override file, the cached `game.graph` and
 * the file index.
 */
import { linkPlugin } from "../../link";
import type { Json, NodeRef, SourceOverrides } from "../../registry/protocol";
import {
  bareMessage,
  flowFile,
  nodeFile,
  parseOverrides,
  SOURCE_OVERRIDES_PATH
} from "../../registry/protocol";
import { notify } from "../store";
import type { FilesViewCtx, FilesViewState, UsedBy } from "../types";

/**
 * A plain JSON object.
 */
type JsonObject = { readonly [key: string]: Json };

/**
 * What the rule needs of a graph node: its own `file` (dev-only, F-H2), its sub-flow and slot.
 */
type NodeInfo = { readonly file?: string; readonly subFlow?: string; readonly slot?: string };

/**
 * A mutable Used-by entry while the map is built.
 */
type Entry = { flows: string[]; nodes: NodeRef[] };

/**
 * True for a JSON object (not null, not an array).
 *
 * @param value - A JSON value.
 * @returns Whether it is an object.
 * @example
 * ```ts
 * isObject({ main: "main" }); // true
 * ```
 */
function isObject(value: Json | undefined): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The flows object of a graph, or undefined when the value is no flow graph.
 *
 * @param graph - The cached game.graph.
 * @returns The flows by name.
 * @example
 * ```ts
 * flowsOf({ main: "main", flows: { main: {} } }); // { main: {} }
 * ```
 */
function flowsOf(graph: Json | undefined): JsonObject | undefined {
  if (!isObject(graph)) return undefined;
  const { flows } = graph;
  return isObject(flows) ? flows : undefined;
}

/**
 * Flow names in walk order: the main flow first, then key order.
 *
 * @param graph - The graph object.
 * @param flows - Its flows.
 * @returns The names.
 * @example
 * ```ts
 * flowOrder({ main: "main" }, { board: {}, main: {} }); // ["main", "board"]
 * ```
 */
function flowOrder(graph: JsonObject, flows: JsonObject): string[] {
  const names = Object.keys(flows);
  const main = graph.main;
  if (typeof main !== "string" || !names.includes(main)) return names;
  return [main, ...names.filter(name => name !== main)];
}

/**
 * The `file` / `subFlow` / `slot` of a node JSON value; a value that is no string is left out.
 *
 * @param value - The node JSON.
 * @returns The node info; `{}` for a plain node.
 * @example
 * ```ts
 * nodeInfoOf({ node: "board", subFlow: "board" }); // { subFlow: "board" }
 * ```
 */
function nodeInfoOf(value: JsonObject): NodeInfo {
  const { file, subFlow, slot } = value;
  return {
    ...(typeof file === "string" ? { file } : {}),
    ...(typeof subFlow === "string" ? { subFlow } : {}),
    ...(typeof slot === "string" ? { slot } : {})
  };
}

/**
 * The Used-by entry of a path, created on first use.
 *
 * @param map - The map being built.
 * @param path - The file path.
 * @returns The entry.
 * @example
 * ```ts
 * entryOf(map, "nodes/merge.ts").nodes.push({ flow: "board", node: "merge" });
 * ```
 */
function entryOf(map: Map<string, Entry>, path: string): Entry {
  const existing = map.get(path);
  if (existing !== undefined) return existing;
  const created: Entry = { flows: [], nodes: [] };
  map.set(path, created);
  return created;
}

/**
 * The file of a graph node, the same rule as flowView's Inspector: the node's own `file` (F-H2)
 * wins, else the protocol `nodeFile`.
 *
 * @param ref - Flow and node name.
 * @param node - The node info; undefined when the graph lacks the node.
 * @param overrides - The parsed override map.
 * @param exists - The file index (`index.files.has`).
 * @returns The path, or undefined.
 * @example
 * ```ts
 * nodeFileOf({ flow: "board", node: "merge" }, { file: "features/x.ts" }, {}, exists); // "features/x.ts"
 * ```
 */
export function nodeFileOf(
  ref: NodeRef,
  node: NodeInfo | undefined,
  overrides: SourceOverrides,
  exists: (path: string) => boolean
): string | undefined {
  if (node?.file !== undefined) return node.file;
  return nodeFile(ref, node, overrides, exists);
}

/**
 * The reverse map path → Used by: every flow whose `flowFile` is the path and every node whose
 * `nodeFileOf` is the path (own `file`, else `nodeFile`). Main flow first, then key order; nodes
 * in key order.
 *
 * @param graph - The cached game.graph; undefined or a non-graph value gives an empty map.
 * @param exists - The file index (`index.files.has`).
 * @param overrides - The parsed override map.
 * @returns The map.
 * @example
 * ```ts
 * buildUsedBy(graph, path => index.files.has(path), {}).get("nodes/merge.ts")?.nodes; // [{ flow: "board", node: "merge" }]
 * ```
 */
export function buildUsedBy(
  graph: Json | undefined,
  exists: (path: string) => boolean,
  overrides: SourceOverrides
): Map<string, UsedBy> {
  const map = new Map<string, Entry>();
  const flows = flowsOf(graph);
  if (flows === undefined || !isObject(graph)) return map;

  for (const flow of flowOrder(graph, flows)) {
    const file = flowFile(flow, overrides, exists);
    if (file !== undefined) entryOf(map, file).flows.push(flow);

    const value = flows[flow];
    const nodes = isObject(value) && isObject(value.nodes) ? value.nodes : {};
    for (const [node, body] of Object.entries(nodes)) {
      if (!isObject(body)) continue;
      const ref: NodeRef = { flow, node };
      const path = nodeFileOf(ref, nodeInfoOf(body), overrides, exists);
      if (path !== undefined) entryOf(map, path).nodes.push(ref);
    }
  }
  return map;
}

/**
 * The `file` / `subFlow` / `slot` of a graph node, for the rule.
 *
 * @param graph - The cached game.graph.
 * @param ref - Flow and node name.
 * @returns The node info, or undefined when the graph lacks the node.
 * @example
 * ```ts
 * graphNodeOf(graph, { flow: "main", node: "board" }); // { subFlow: "board" }
 * ```
 */
export function graphNodeOf(graph: Json | undefined, ref: NodeRef): NodeInfo | undefined {
  const flow = flowsOf(graph)?.[ref.flow];
  const nodes = isObject(flow) ? flow.nodes : undefined;
  const node = isObject(nodes) ? nodes[ref.node] : undefined;
  return isObject(node) ? nodeInfoOf(node) : undefined;
}

/**
 * The start node of a flow (a flow chip selects it).
 *
 * @param graph - The cached game.graph.
 * @param flow - The flow name.
 * @returns The start node name, or undefined.
 * @example
 * ```ts
 * flowStartOf(graph, "board"); // "awaitIntent"
 * ```
 */
export function flowStartOf(graph: Json | undefined, flow: string): string | undefined {
  const value = flowsOf(graph)?.[flow];
  const start = isObject(value) ? value.start : undefined;
  return typeof start === "string" ? start : undefined;
}

/**
 * The file-index lookup the rule takes; nothing exists before the first index.
 *
 * @param state - filesView state.
 * @returns `path => index.files.has(path)`.
 * @example
 * ```ts
 * existsIn(ctx.state)("nodes/merge.ts"); // true once indexed
 * ```
 */
export function existsIn(state: FilesViewState): (path: string) => boolean {
  const files = state.index?.files;
  return path => files?.has(path) === true;
}

/**
 * Rebuilds the Used-by map from the graph, the index and the overrides; undefined without a
 * graph.
 *
 * @param ctx - Domain context of filesView.
 * @example
 * ```ts
 * ctx.state.overrides = await loadOverrides(ctx);
 * rebuildUsedBy(ctx);
 * ```
 */
export function rebuildUsedBy(ctx: FilesViewCtx): void {
  const { state } = ctx;
  state.usedBy =
    state.graph === undefined
      ? undefined
      : buildUsedBy(state.graph, existsIn(state), state.overrides);
}

/**
 * Reads and parses the override file; problems are warned once; a missing or unreadable file
 * gives `{}` with a debug line.
 *
 * @param ctx - Domain context of filesView.
 * @returns The override map.
 * @example
 * ```ts
 * ctx.state.overrides = await loadOverrides(ctx);
 * ```
 */
export async function loadOverrides(ctx: FilesViewCtx): Promise<SourceOverrides> {
  let text: string;
  try {
    ({ text } = await ctx.require(linkPlugin).files.read(SOURCE_OVERRIDES_PATH));
  } catch {
    ctx.log.debug("filesView:overrides-missing", { path: SOURCE_OVERRIDES_PATH });
    return {};
  }

  const { overrides, problems } = parseOverrides(text);
  if (problems.length > 0) ctx.log.warn("filesView:overrides-invalid", { problems });
  return overrides;
}

/**
 * Reads `game.graph` of the current session (no manifest: no graph), rebuilds Used by and
 * notifies. A failed read is warned and leaves no graph. Called on every manifest.
 *
 * @param ctx - Domain context of filesView.
 * @returns When the graph is stored.
 * @example
 * ```ts
 * link.onManifest(() => { loadGraph(ctx).catch(() => undefined); });
 * ```
 */
export async function loadGraph(ctx: FilesViewCtx): Promise<void> {
  const link = ctx.require(linkPlugin);
  const { state } = ctx;

  if (link.manifest() === undefined) {
    state.graph = undefined;
  } else {
    try {
      state.graph = await link.read("game.graph");
    } catch (error) {
      state.graph = undefined;
      ctx.log.warn("filesView:graph-failed", {
        message: bareMessage(error instanceof Error ? error.message : String(error))
      });
    }
  }
  rebuildUsedBy(ctx);
  notify(state);
}
