/**
 * @file flowView inspector module — where a node's code is: the project index key of a node and
 * the texts of the Code tab. The index is the only source (amendment N): no rule, no override
 * file, no line search.
 */

import { notFoundText } from "../../panels/shared/project";
import type { ProjectState } from "../../registry/protocol";
import { firstDefinition } from "../../registry/protocol";
import type { NodeId } from "../types";

/**
 * The Code tab line while the read is pending or the link is lost.
 */
export const SOURCE_LOADS = "Source loads from the dev server.";

/**
 * The Code tab line of a file over 5000 lines.
 */
export const TOO_LONG = "File too long to show here · Open in Files";

/**
 * Longest file the Code tab shows.
 */
export const MAX_LINES = 5000;

/**
 * The project-index key of a graph node.
 *
 * @param id - A node id, "<flow>/<node>".
 * @returns The key to `find`.
 * @example
 * ```ts
 * nodeKey("board/merge"); // "node:board/merge"
 * ```
 */
export function nodeKey(id: NodeId): string {
  return `node:${id}`;
}

/**
 * Why a node shows no code: the index is off, or it does not know the node. A node the index
 * knows whose file could not be read is a link problem, not a missing key.
 *
 * @param project - The project state (`link.project()`).
 * @param id - The node id.
 * @returns The Code tab line.
 * @example
 * ```ts
 * missingCodeText({ state: "off", reason: "typescript is not installed" }, "board/merge");
 * // "Project index is off: typescript is not installed"
 * missingCodeText(onState, "main/settings"); // "Not in the project index: node:main/settings"
 * ```
 */
export function missingCodeText(project: ProjectState | undefined, id: NodeId): string {
  const key = nodeKey(id);
  return firstDefinition(project, key) === undefined ? notFoundText(project, key) : SOURCE_LOADS;
}
