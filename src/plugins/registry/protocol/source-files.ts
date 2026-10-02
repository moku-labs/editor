/**
 * @file Protocol — the one node → file rule of the editor (R1): overrides from
 * `.moku/editor/files.json`, then no own file for sub-flow and slot nodes, then the
 * `nodes/<kebab>.ts|tsx` and `flows/<flow>.ts` convention under SOURCE_ROOTS. Pure: the caller
 * passes its file index as `exists`. flowView and filesView both use it.
 */

/**
 * A graph node by flow and node name.
 */
export type NodeRef = { readonly flow: string; readonly node: string };

/**
 * Parsed `.moku/editor/files.json`: keys `<flow>`, `<flow>/<node>`, `<flow>/*`; value a relative
 * path, or null for "no file".
 */
export type SourceOverrides = Readonly<Record<string, string | null>>;

/**
 * Where the override map lives, relative to the project root.
 */
export const SOURCE_OVERRIDES_PATH = ".moku/editor/files.json";

/**
 * The roots the convention tries, in order.
 */
export const SOURCE_ROOTS: readonly string[] = ["", "src/"];

/**
 * kebab-case of a node name: `awaitIntent` → `await-intent`, `HTTPServer` → `http-server`.
 *
 * @param _name - A node or flow name.
 * @example
 * ```ts
 * kebab("level2Boss"); // "level2-boss"
 * ```
 */
export function kebab(_name: string): string {
  throw new Error("not implemented");
}

/**
 * The source file of a flow, or undefined.
 *
 * @param _flow - The flow name.
 * @param _overrides - The parsed override map.
 * @param _exists - The caller's file index.
 * @example
 * ```ts
 * flowFile("board", {}, path => index.has(path)); // "flows/board.ts"
 * ```
 */
export function flowFile(
  _flow: string,
  _overrides: SourceOverrides,
  _exists: (path: string) => boolean
): string | undefined {
  throw new Error("not implemented");
}

/**
 * The source file of a graph node, or undefined (sub-flow and slot nodes have no own file).
 *
 * @param _ref - Flow and node name.
 * @param _node - The graph node (`subFlow`, `slot`), when known.
 * @param _overrides - The parsed override map.
 * @param _exists - The caller's file index.
 * @example
 * ```ts
 * nodeFile({ flow: "board", node: "awaitIntent" }, undefined, {}, path => index.has(path)); // "nodes/await-intent.ts"
 * ```
 */
export function nodeFile(
  _ref: NodeRef,
  _node: { readonly subFlow?: string; readonly slot?: string } | undefined,
  _overrides: SourceOverrides,
  _exists: (path: string) => boolean
): string | undefined {
  throw new Error("not implemented");
}

/**
 * Parses the override file; bad entries are dropped and named in `problems`.
 *
 * @param _text - The text of `.moku/editor/files.json`.
 * @example
 * ```ts
 * const { overrides, problems } = parseOverrides('{ "settingsPopup/*": "features/settings/nodes.ts" }');
 * ```
 */
export function parseOverrides(_text: string): {
  overrides: SourceOverrides;
  problems: readonly string[];
} {
  throw new Error("not implemented");
}
