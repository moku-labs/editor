/**
 * @file gameView plugin — the component sources of the fuller area card (captures-by-day U5): a
 * group root or a child in the tree whose JSX line is a component instance
 * (`<RoundButton id="homeSettings" …>`) gets the definition of that component, once per
 * component. Keys and definitions are found with the bounded source search: remembered ones are
 * free, the rest take from the area's 10 new searches (A18). A definition is remembered in
 * `state.found` under `<Name>`, which no ui key can be. Nothing here throws.
 */
import type { SceneNode } from "../../panels/shared/scene";
import { keyColumn } from "../element/jsx";
import { findStyleSource, readText, sourceFiles } from "../element/source";
import type { CodeSnippet, GameViewCtx, StyleSource } from "../types";
import type { AreaBranch } from "./area-tree";

/**
 * The most lines a definition snippet shows.
 */
export const DEFINITION_LINES = 60;

/**
 * The lines above a key line searched for the tag that holds the key.
 */
const TAG_LINES = 8;

/**
 * An opening JSX tag and its name (`<RoundButton`, `<column`, `<Kit.Button`).
 */
const OPEN_TAG = /<([$A-Z_a-z][\w$.]*)/g;

/**
 * A component name: a capital first letter, no member access.
 */
const COMPONENT_NAME = /^[A-Z][\w$]*$/;

/**
 * Regex special characters of a name.
 */
const REGEX_SPECIAL = /[$()*+.?[\\\]^{|}]/g;

/**
 * The searches an area may still start (A18), shared by the keys and the definitions.
 *
 * @example
 * ```ts
 * const budget: SearchBudget = { left: 10 };
 * ```
 */
export type SearchBudget = { left: number };

/**
 * The definition of a component the area uses, under the key that first uses it.
 *
 * @example
 * ```ts
 * const component: AreaComponent = { key: "homeSettings", name: "RoundButton", snippet: { path: "features/ui/kit.tsx", line: 418, lines: ["export function RoundButton(props: RoundButtonProps) {"] } };
 * ```
 */
export type AreaComponent = {
  readonly key: string;
  readonly name: string;
  readonly snippet: CodeSnippet;
};

/**
 * The component whose tag holds a key: the nearest opening tag before the key, on its line or up
 * to eight lines above; a lowercase (intrinsic) or member tag is none.
 *
 * @param lines - The file lines.
 * @param line - The 1-based key line.
 * @param column - The 0-based column of the key on it.
 * @returns The component name, undefined for none.
 * @example
 * ```ts
 * componentAt(['<RoundButton id="homeSettings" />'], 1, 13); // "RoundButton"
 * ```
 */
export function componentAt(
  lines: readonly string[],
  line: number,
  column: number
): string | undefined {
  const first = Math.max(0, line - 1 - TAG_LINES);
  const before = [...lines.slice(first, line - 1), (lines[line - 1] ?? "").slice(0, column)];
  const tag = [...before.join("\n").matchAll(OPEN_TAG)].at(-1)?.[1];
  return tag !== undefined && COMPONENT_NAME.test(tag) ? tag : undefined;
}

/**
 * The line that defines a component: `function Name(`, `function Name<`, or `const Name =`
 * (`let`, a type annotation allowed).
 *
 * @param text - A file text.
 * @param name - The component name.
 * @returns The 1-based line, undefined when the file does not define it.
 * @example
 * ```ts
 * definitionLine("export function RoundButton(props: P) {", "RoundButton"); // 1
 * ```
 */
export function definitionLine(text: string, name: string): number | undefined {
  const escaped = name.replaceAll(REGEX_SPECIAL, String.raw`\$&`);
  const pattern = new RegExp(
    String.raw`(?:\bfunction\s+${escaped}\s*[(<]|\b(?:const|let)\s+${escaped}\s*(?::[^=]*)?=)`
  );
  const index = text.split("\n").findIndex(entry => pattern.test(entry));
  return index === -1 ? undefined : index + 1;
}

/**
 * The braces a line opens minus the ones it closes.
 *
 * @param line - A line.
 * @returns The change of the brace depth.
 * @example
 * ```ts
 * braceChange("function A() {"); // 1
 * ```
 */
function braceChange(line: string): number {
  let change = 0;
  for (const char of line) {
    if (char === "{") change += 1;
    if (char === "}") change -= 1;
  }
  return change;
}

/**
 * The lines of a definition: from its line to the one where its braces close (a line without
 * braces that ends with `;` closes an arrow), 60 lines at most.
 *
 * @param lines - The file lines.
 * @param line - The 1-based definition line.
 * @returns The first and the last line.
 * @example
 * ```ts
 * definitionRange(["function A() {", "  return 1;", "}"], 1); // { start: 1, end: 3 }
 * ```
 */
export function definitionRange(
  lines: readonly string[],
  line: number
): { readonly start: number; readonly end: number } {
  const last = Math.min(lines.length, line - 1 + DEFINITION_LINES);
  let depth = 0;
  let opened = false;
  for (let index = line - 1; index < last; index += 1) {
    const text = lines[index] ?? "";
    const change = braceChange(text);
    depth += change;
    opened ||= text.includes("{");
    if (opened && depth <= 0) return { start: line, end: index + 1 };
    if (!opened && text.trimEnd().endsWith(";")) return { start: line, end: index + 1 };
  }
  return { start: line, end: last };
}

/**
 * The text of a file, read once per area.
 *
 * @param ctx - Domain context of gameView.
 * @param texts - The texts read so far, by path.
 * @param path - The file.
 * @returns Its text, undefined when it cannot be read.
 */
async function textOnce(
  ctx: GameViewCtx,
  texts: Map<string, string | undefined>,
  path: string
): Promise<string | undefined> {
  if (!texts.has(path)) texts.set(path, await readText(ctx, path));
  return texts.get(path);
}

/**
 * The source of a key: remembered, else a search when the budget has one left.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @param budget - The searches left.
 * @returns The source, undefined when none is known or found.
 */
async function keySource(
  ctx: GameViewCtx,
  key: string,
  budget: SearchBudget
): Promise<StyleSource | undefined> {
  const known = ctx.state.found.get(key);
  if (known !== undefined || budget.left <= 0) return known;
  budget.left -= 1;
  try {
    return await findStyleSource(ctx, key);
  } catch {
    return undefined;
  }
}

/**
 * Searches the source files for the definition of a component, and remembers it.
 *
 * @param ctx - Domain context of gameView.
 * @param name - The component name.
 * @param budget - The searches left.
 * @returns Where the component is defined, undefined when unknown or not found.
 */
async function definitionSource(
  ctx: GameViewCtx,
  name: string,
  budget: SearchBudget
): Promise<StyleSource | undefined> {
  const memo = `<${name}>`;
  const known = ctx.state.found.get(memo);
  if (known !== undefined || budget.left <= 0) return known;
  budget.left -= 1;
  try {
    for await (const path of sourceFiles(ctx)) {
      const text = await readText(ctx, path);
      const line = text === undefined ? undefined : definitionLine(text, name);
      if (line === undefined) continue;
      const source: StyleSource = { kind: "defined", path, line };
      ctx.state.found.set(memo, source);
      return source;
    }
  } catch (error) {
    ctx.log.debug("gameView: component search failed", { name, error });
  }
  return undefined;
}

/**
 * The keyed nodes whose component the card may show: the roots first, then the tree's children,
 * in card order.
 *
 * @param roots - The group roots.
 * @param branches - The tree of each root.
 * @returns The keyed nodes.
 */
function keyedNodes(
  roots: readonly SceneNode[],
  branches: ReadonlyMap<string, AreaBranch>
): SceneNode[] {
  const children = roots.flatMap(
    root => branches.get(root.id)?.children.map(child => child.node) ?? []
  );
  return [...roots, ...children].filter(node => node.key !== undefined);
}

/**
 * The definitions of the components the area's roots and children are instances of, once per
 * component, under the first key that uses it. Searches take from the budget.
 *
 * @param ctx - Domain context of gameView.
 * @param roots - The group roots.
 * @param branches - The tree of each root.
 * @param budget - The searches the area may still start.
 * @returns The component snippets, in card order.
 */
export async function areaComponents(
  ctx: GameViewCtx,
  roots: readonly SceneNode[],
  branches: ReadonlyMap<string, AreaBranch>,
  budget: SearchBudget
): Promise<readonly AreaComponent[]> {
  const texts = new Map<string, string | undefined>();
  const components: AreaComponent[] = [];
  const seen = new Set<string>();

  for (const node of keyedNodes(roots, branches)) {
    const key = node.key ?? "";
    const source = await keySource(ctx, key, budget);
    const text = source === undefined ? undefined : await textOnce(ctx, texts, source.path);
    if (source === undefined || text === undefined) continue;

    // The component the key line belongs to, once per name.
    const lines = text.split("\n");
    const name = componentAt(lines, source.line, keyColumn(lines[source.line - 1] ?? "", key));
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);

    // Its definition, cut to the braces that close it.
    const definition = await definitionSource(ctx, name, budget);
    const file = definition === undefined ? undefined : await textOnce(ctx, texts, definition.path);
    if (definition === undefined || file === undefined) continue;
    const fileLines = file.split("\n");
    const range = definitionRange(fileLines, definition.line);
    const snippet = {
      path: definition.path,
      line: range.start,
      lines: fileLines.slice(range.start - 1, range.end)
    };
    components.push({ key, name, snippet });
  }
  return components;
}
