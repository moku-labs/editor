/**
 * @file gameView plugin — the component sources of the fuller area card (captures-by-day U5): a
 * group root or a child in the tree whose element is a component instance
 * (`<RoundButton id="homeSettings" …>`, the tag that opens the range the project index answered
 * for its key) gets the definition of that component, once per component: the first answer of
 * `component:<Name>` (G1), cut to 60 lines. Keys and definitions come from the index only; a
 * component it does not know is left out. Nothing here throws.
 */
import { linkPlugin } from "../../link";
import { findFresh } from "../../panels/shared/project";
import type { SceneNode } from "../../panels/shared/scene";
import { snippetOf, tagNameAt } from "../element/jsx";
import { findStyleSource, readText } from "../element/source";
import type { CodeSnippet, GameViewCtx, SourceRange, StyleSource } from "../types";
import type { AreaBranch } from "./area-tree";

/**
 * The most lines a definition snippet shows.
 */
export const DEFINITION_LINES = 60;

/**
 * A component name: a capital first letter, no member access.
 */
const COMPONENT_NAME = /^[A-Z][\w$]*$/;

/**
 * The definition of a component the area uses, under the key that first uses it.
 */
export type AreaComponent = {
  readonly key: string;
  readonly name: string;
  readonly snippet: CodeSnippet;
};

/**
 * The component an element is an instance of: the tag that opens its range, when that tag is a
 * component (a capital name); an intrinsic (`<column>`) or a member tag (`<Kit.Button>`) is none.
 *
 * @param lines - The file lines.
 * @param range - The index answer's range of the element.
 * @returns The component name, undefined for none.
 * @example
 * ```ts
 * componentAt(['          <RoundButton id="homeSettings" />'], [1, 11, 1, 46]); // "RoundButton"
 * ```
 */
export function componentAt(lines: readonly string[], range: SourceRange): string | undefined {
  const tag = tagNameAt(lines, range);
  return tag !== undefined && COMPONENT_NAME.test(tag) ? tag : undefined;
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
 * The source of a key: remembered, else the index answer.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns The source, undefined when the index has no answer.
 */
async function keySource(ctx: GameViewCtx, key: string): Promise<StyleSource | undefined> {
  return ctx.state.found.get(key) ?? (await findStyleSource(ctx, key));
}

/**
 * The definition of a component: the first answer of `component:<Name>`, cut to 60 lines.
 *
 * @param ctx - Domain context of gameView.
 * @param name - The component name.
 * @returns The snippet, undefined when the index has no answer or its file cannot be read.
 */
async function definitionSnippet(ctx: GameViewCtx, name: string): Promise<CodeSnippet | undefined> {
  const fresh = await findFresh(ctx.require(linkPlugin).files, `component:${name}`);
  if (fresh === undefined) return undefined;
  return snippetOf(fresh.found.path, fresh.text, fresh.found.range, DEFINITION_LINES);
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
 * component, under the first key that uses it.
 *
 * @param ctx - Domain context of gameView.
 * @param roots - The group roots.
 * @param branches - The tree of each root.
 * @returns The component snippets, in card order.
 */
export async function areaComponents(
  ctx: GameViewCtx,
  roots: readonly SceneNode[],
  branches: ReadonlyMap<string, AreaBranch>
): Promise<readonly AreaComponent[]> {
  const texts = new Map<string, string | undefined>();
  const components: AreaComponent[] = [];
  const seen = new Set<string>();

  for (const node of keyedNodes(roots, branches)) {
    const key = node.key ?? "";
    const source = await keySource(ctx, key);
    const text = source === undefined ? undefined : await textOnce(ctx, texts, source.path);
    if (source === undefined || text === undefined) continue;

    // The component the element is an instance of, once per name.
    const name = componentAt(text.split("\n"), source.range);
    if (name === undefined || seen.has(name)) continue;
    seen.add(name);

    // Its definition, as the index answers it.
    const snippet = await definitionSnippet(ctx, name);
    if (snippet === undefined) continue;
    components.push({ key, name, snippet });
  }
  return components;
}
