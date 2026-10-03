/**
 * @file Protocol — the one node → file rule of the editor (R1): overrides from
 * `.moku/editor/files.json`, then no own file for sub-flow and slot nodes, then the
 * `nodes/<kebab>.ts|tsx` and `flows/<flow>.ts` convention under SOURCE_ROOTS. Pure: the caller
 * passes its file index in `exists`. flowView and filesView both use it.
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
 * A valid override key: `<flow>`, `<flow>/<node>` or `<flow>/*`.
 */
const KEY_PATTERN = /^[\w$-]+(?:\/(?:[\w$-]+|\*))?$/;

/**
 * kebab-case of a node name: `awaitIntent` → `await-intent`, `HTTPServer` → `http-server`.
 *
 * @param name - A node or flow name.
 * @returns The kebab-case file stem.
 * @example
 * ```ts
 * kebab("level2Boss"); // "level2-boss"
 * ```
 */
export function kebab(name: string): string {
  return name
    .replaceAll(/([\da-z])([A-Z])/g, "$1-$2")
    .replaceAll(/([A-Z])(?=[A-Z][a-z])/g, "$1-")
    .replaceAll(/[\s_]/g, "-")
    .toLowerCase()
    .replaceAll(/-+/g, "-");
}

/**
 * Resolves an override value: a path counts only when it exists; null means no file.
 *
 * @param value - The override value.
 * @param exists - The caller's file index.
 * @returns The path, or undefined.
 * @example
 * ```ts
 * overrideFile("features/settings/nodes.ts", path => index.has(path));
 * ```
 */
function overrideFile(
  value: string | null | undefined,
  exists: (path: string) => boolean
): string | undefined {
  return typeof value === "string" && exists(value) ? value : undefined;
}

/**
 * The first candidate that exists in the file index.
 *
 * @param candidates - Paths in the order the rule tries them.
 * @param exists - The caller's file index.
 * @returns The first existing path, or undefined.
 * @example
 * ```ts
 * firstExisting(["flows/board.ts", "src/flows/board.ts"], path => index.has(path));
 * ```
 */
function firstExisting(
  candidates: readonly string[],
  exists: (path: string) => boolean
): string | undefined {
  return candidates.find(path => exists(path));
}

/**
 * The source file of a flow, or undefined.
 *
 * @param flow - The flow name.
 * @param overrides - The parsed override map.
 * @param exists - The caller's file index.
 * @returns The path of the flow file, or undefined.
 * @example
 * ```ts
 * flowFile("board", {}, path => index.has(path)); // "flows/board.ts"
 * ```
 */
export function flowFile(
  flow: string,
  overrides: SourceOverrides,
  exists: (path: string) => boolean
): string | undefined {
  if (Object.hasOwn(overrides, flow)) return overrideFile(overrides[flow], exists);

  return firstExisting(
    SOURCE_ROOTS.map(root => `${root}flows/${flow}.ts`),
    exists
  );
}

/**
 * The source file of a graph node, or undefined (sub-flow and slot nodes have no own file).
 *
 * @param ref - Flow and node name.
 * @param node - The graph node (`subFlow`, `slot`), when known.
 * @param overrides - The parsed override map.
 * @param exists - The caller's file index.
 * @returns The path of the node file, or undefined.
 * @example
 * ```ts
 * nodeFile({ flow: "board", node: "awaitIntent" }, undefined, {}, path => index.has(path)); // "nodes/await-intent.ts"
 * ```
 */
export function nodeFile(
  ref: NodeRef,
  node: { readonly subFlow?: string; readonly slot?: string } | undefined,
  overrides: SourceOverrides,
  exists: (path: string) => boolean
): string | undefined {
  const key = [`${ref.flow}/${ref.node}`, `${ref.flow}/*`].find(candidate =>
    Object.hasOwn(overrides, candidate)
  );

  if (key !== undefined) return overrideFile(overrides[key], exists);
  if (node?.subFlow !== undefined || node?.slot !== undefined) return undefined;

  const stem = kebab(ref.node);

  return firstExisting(
    SOURCE_ROOTS.flatMap(root => [`${root}nodes/${stem}.ts`, `${root}nodes/${stem}.tsx`]),
    exists
  );
}

/**
 * True for an override value: null, or a relative posix path (no leading `/`, no `..`, no `\\`).
 *
 * @param value - A parsed value.
 * @returns Whether the value may stay in the override map.
 * @example
 * ```ts
 * isOverrideValue("../x.ts"); // false
 * ```
 */
function isOverrideValue(value: unknown): value is string | null {
  if (value === null) return true;

  return (
    typeof value === "string" &&
    value !== "" &&
    !value.startsWith("/") &&
    !value.includes("\\") &&
    !value.split("/").includes("..")
  );
}

/**
 * Parses the override file; bad entries are dropped and named in `problems`.
 *
 * @param text - The text of `.moku/editor/files.json`.
 * @returns The override map and the problems to log.
 * @example
 * ```ts
 * const { overrides, problems } = parseOverrides('{ "settingsPopup/*": "features/settings/nodes.ts" }');
 * ```
 */
export function parseOverrides(text: string): {
  overrides: SourceOverrides;
  problems: readonly string[];
} {
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    return {
      overrides: {},
      problems: [`${SOURCE_OVERRIDES_PATH} is not JSON; no override applies`]
    };
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { overrides: {}, problems: [`${SOURCE_OVERRIDES_PATH} must hold one JSON object`] };
  }

  const entries: [string, string | null][] = [];
  const problems: string[] = [];

  for (const [key, raw] of Object.entries(parsed)) {
    const value: unknown = raw;

    if (!KEY_PATTERN.test(key)) {
      problems.push(
        `${SOURCE_OVERRIDES_PATH}: "${key}" is not a key like <flow>, <flow>/<node> or <flow>/*`
      );
    } else if (isOverrideValue(value)) {
      entries.push([key, value]);
    } else {
      problems.push(
        `${SOURCE_OVERRIDES_PATH}: "${key}" must be null or a relative path in the project`
      );
    }
  }

  return { overrides: Object.freeze(Object.fromEntries(entries)), problems };
}
