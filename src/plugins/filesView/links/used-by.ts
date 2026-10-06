/**
 * @file filesView plugin — Used by from the project index (D-38): the flows and nodes a file
 * defines (`flow:` and `node:` defs) and the files that use what it defines (`usedIn` of
 * panels/shared/project). The cached `game.graph` only names the start node of a flow chip.
 */
import { linkPlugin } from "../../link";
import { usedIn } from "../../panels/shared/project";
import type { Json, NodeRef, ProjectState } from "../../registry/protocol";
import { errorCode, isRetryable, isWireError } from "../../registry/protocol";
import { messageOf } from "../errors";
import { notify } from "../store";
import type { FilesViewCtx, UsedBy } from "../types";

/**
 * A plain JSON object.
 */
type JsonObject = { readonly [key: string]: Json };

/**
 * The key prefix of a flow definition.
 */
const FLOW_KEY = "flow:";

/**
 * The key prefix of a node definition: `node:<flow>/<node>`.
 */
const NODE_KEY = "node:";

/**
 * Used by of a file the index does not know, or of any file while the index is off.
 */
const NOTHING: UsedBy = Object.freeze({ flows: [], nodes: [], usedIn: [] });

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
 * The flow and node of a `node:` key.
 *
 * @param key - A project-index key.
 * @returns The node, or undefined for another key or a node key without a flow.
 * @example
 * ```ts
 * nodeOfKey("node:settingsPopup/open"); // { flow: "settingsPopup", node: "open" }
 * ```
 */
function nodeOfKey(key: string): NodeRef | undefined {
  if (!key.startsWith(NODE_KEY)) return undefined;

  const id = key.slice(NODE_KEY.length);
  const slash = id.indexOf("/");
  if (slash === -1) return undefined;

  return { flow: id.slice(0, slash), node: id.slice(slash + 1) };
}

/**
 * What the project index knows of a file: the flows and nodes defined in it (both files of a
 * conflict count), in def order, and the files that use anything it defines.
 *
 * @param project - The project state (`link.project()`); undefined before the first.
 * @param path - A root-relative file.
 * @returns The Used by; empty while the index is off.
 * @example
 * ```ts
 * // The Used by row of the settings popup's nodes file.
 * usedByOf(link.project(), "features/settings/nodes.ts");
 * // { flows: [], nodes: [{ flow: "settingsPopup", node: "open" }], usedIn: ["features/settings/flow.ts"] }
 * ```
 */
export function usedByOf(project: ProjectState | undefined, path: string): UsedBy {
  if (project?.state !== "on") return NOTHING;

  const flows: string[] = [];
  const nodes: NodeRef[] = [];
  for (const [key, paths] of Object.entries(project.defs)) {
    if (!paths.includes(path)) continue;

    if (key.startsWith(FLOW_KEY)) flows.push(key.slice(FLOW_KEY.length));
    const node = nodeOfKey(key);
    if (node !== undefined) nodes.push(node);
  }

  return { flows, nodes, usedIn: usedIn(project, path) };
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
  if (!isObject(graph) || !isObject(graph.flows)) return undefined;

  const value = graph.flows[flow];
  const start = isObject(value) ? value.start : undefined;
  return typeof start === "string" ? start : undefined;
}

/**
 * True for a read the reload of the game page took away: a retryable error (-32001
 * `game_reloaded`, -32002 when the link closed or timed out, any `data.retryable`) or -32003
 * because the session closed meanwhile.
 *
 * @param error - The rejection.
 * @returns Whether the next manifest will read again.
 * @example
 * ```ts
 * isReadLostToReload(wireError(-32_001, "game reloaded", { reason: "game_reloaded" })); // true
 * isReadLostToReload(wireError(-32_003, "No game is connected.", { reason: "no_session" })); // true
 * ```
 */
function isReadLostToReload(error: unknown): boolean {
  return isRetryable(error) || (isWireError(error) && error.code === errorCode.noSession);
}

/**
 * Reads `game.graph` of the current session (no manifest: no graph) and notifies. A failed read
 * leaves no graph: one lost to a reload (retryable, or its session closed meanwhile; the next
 * manifest reads again) is logged at debug, any other is warned. Called on every manifest.
 *
 * @param ctx - Domain context of filesView.
 * @returns When the graph is stored.
 */
export async function loadGraph(ctx: FilesViewCtx): Promise<void> {
  const link = ctx.require(linkPlugin);
  const { state } = ctx;

  // No manifest, no session: no graph.
  if (link.manifest() === undefined) {
    state.graph = undefined;
    notify(state);
    return;
  }

  try {
    state.graph = await link.read("game.graph");
  } catch (error) {
    state.graph = undefined;
    const details = { message: messageOf(error) };
    if (isReadLostToReload(error)) ctx.log.debug("filesView:graph-failed", details);
    else ctx.log.warn("filesView:graph-failed", details);
  }
  notify(state);
}
