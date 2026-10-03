/**
 * @file flowView inspector module — the node → file lookup through the one rule of the editor
 * (registry/protocol source-files.ts, R1): the overrides file, the listings of the folders the rule
 * can name, a graph node's own file (F-H2), and the line of the node in its file.
 */
import type { Log } from "@moku-labs/common/browser";
import type { FilesClient } from "../../link/types";
import {
  nodeFile,
  parseOverrides,
  SOURCE_OVERRIDES_PATH,
  SOURCE_ROOTS
} from "../../registry/protocol";
import type { GraphJson, NodeId } from "../types";
import type { SourceLookup } from "./types";

/**
 * The Code tab line of a sub-flow, slot or null-override node.
 */
export const NO_OWN_FILE = "This node has no file of its own.";

/**
 * The Code tab line of a node whose file the rule does not find.
 */
export const NO_FILE_FOUND = "No file found for this node · press ⌘K and type its name.";

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
 * Splits a node id.
 *
 * @param id - "<flow>/<node>".
 * @returns Flow and node.
 * @example
 * ```ts
 * split("board/merge"); // { flow: "board", node: "merge" }
 * ```
 */
function split(id: NodeId): { readonly flow: string; readonly node: string } {
  const slash = id.indexOf("/");
  return { flow: id.slice(0, Math.max(0, slash)), node: id.slice(slash + 1) };
}

/**
 * The folder of a path.
 *
 * @param path - A file path.
 * @returns Its folder ("" for the root).
 * @example
 * ```ts
 * folderOf("features/settings/nodes.ts"); // "features/settings"
 * ```
 */
function folderOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

/**
 * Builds the inputs of the node → file rule for this session: the overrides (a read error = none;
 * problems warned once) and the files of the folders the rule can name (missing folders are empty).
 *
 * @param files - link.files.
 * @param log - ctx.log.
 * @returns The lookup.
 * @example
 * ```ts
 * const lookup = await loadSourceLookup(link.files, ctx.log);
 * ```
 */
export async function loadSourceLookup(
  files: Pick<FilesClient, "list" | "read">,
  log: Log.LogApi
): Promise<SourceLookup> {
  let overrides: SourceLookup["overrides"] = {};
  try {
    const file = await files.read(SOURCE_OVERRIDES_PATH);
    const parsed = parseOverrides(file.text);
    overrides = parsed.overrides;
    if (parsed.problems.length > 0)
      log.warn("flowView:overrides-invalid", { problems: [...parsed.problems] });
  } catch (error) {
    log.debug("flowView: no source overrides", { reason: String(error) });
  }

  const folders = SOURCE_ROOTS.flatMap(root => [`${root}nodes`, `${root}flows`]);
  for (const target of Object.values(overrides)) {
    if (typeof target === "string" && !folders.includes(folderOf(target)))
      folders.push(folderOf(target));
  }

  const exists = new Set<string>();
  for (const folder of folders) {
    try {
      for (const entry of await files.list(folder))
        if (entry.kind === "file") exists.add(entry.path);
    } catch {
      // A folder the project does not have lists as empty.
    }
  }
  return { exists, overrides };
}

/**
 * The file of a node: its graph `file` (F-H2), else the rule of source-files.ts.
 *
 * @param lookup - The session lookup.
 * @param graph - The graph.
 * @param id - A node id.
 * @returns The path, or undefined.
 * @example
 * ```ts
 * fileOfNode(lookup, graph, "board/merge"); // "nodes/merge.ts"
 * ```
 */
export function fileOfNode(lookup: SourceLookup, graph: GraphJson, id: NodeId): string | undefined {
  const ref = split(id);
  const node = graph.flows[ref.flow]?.nodes[ref.node];
  if (node?.file !== undefined) return node.file;
  return nodeFile(ref, node, lookup.overrides, path => lookup.exists.has(path));
}

/**
 * Why a node shows no code: it has no file of its own (sub-flow, slot, null override), or its file
 * is not found.
 *
 * @param lookup - The session lookup.
 * @param graph - The graph.
 * @param id - A node id.
 * @returns The Code tab line.
 * @example
 * ```ts
 * noFileText(lookup, graph, "main/settings"); // "This node has no file of its own."
 * ```
 */
export function noFileText(lookup: SourceLookup, graph: GraphJson, id: NodeId): string {
  const ref = split(id);
  const node = graph.flows[ref.flow]?.nodes[ref.node];
  const key = [id, `${ref.flow}/*`].find(candidate => Object.hasOwn(lookup.overrides, candidate));
  const nulled = key !== undefined && lookup.overrides[key] === null;
  return nulled || node?.subFlow !== undefined || node?.slot !== undefined
    ? NO_OWN_FILE
    : NO_FILE_FOUND;
}

/**
 * Escapes a name for a regular expression.
 *
 * @param text - A name.
 * @returns The escaped text.
 * @example
 * ```ts
 * escapeName("a$b"); // "a\\$b"
 * ```
 */
function escapeName(text: string): string {
  return text.replaceAll(/[$()*+.?[\\\]^{|}]/g, String.raw`\$&`);
}

/**
 * The line of a node in its file: the first `const|let|function <name>`, else `<name>:` or
 * `<name> =`, else 1.
 *
 * @param text - The file text.
 * @param node - The node name.
 * @returns The 1-based line.
 * @example
 * ```ts
 * lineOf("a\nexport const merge = node({});", "merge"); // 2
 * ```
 */
export function lineOf(text: string, node: string): number {
  const name = escapeName(node);
  const lines = text.split(/\r?\n/);
  const declaration = new RegExp(String.raw`\b(?:const|let|function)\s+${name}\b`);
  const key = new RegExp(String.raw`\b${name}\s*[:=]`);
  const found = lines.findIndex(line => declaration.test(line));
  if (found !== -1) return found + 1;
  const keyed = lines.findIndex(line => key.test(line));
  return keyed === -1 ? 1 : keyed + 1;
}
