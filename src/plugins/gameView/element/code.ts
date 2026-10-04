/**
 * @file gameView plugin — the code of a picked element (round 2b R12) for the Element tab's Code
 * section and the reference card: a ui element's JSX (element/jsx around the line the source
 * search found) and the `defineStyle` block of `style={ident}` (the style card's loader); an
 * entity's projection, the line that defines it (element/spawn) and its components with their
 * values from the raw `game.entities`. Nothing here throws: what cannot be read is left out.
 */
import type { SceneNode } from "../../panels/shared/scene";
import type { Json } from "../../registry/protocol";
import { isObject } from "../capture/shot";
import type {
  CodeSnippet,
  ComponentRow,
  ElementCode,
  GameViewCtx,
  StyleSnippet,
  StyleSource
} from "../types";
import { styleValue } from "../ui/text";
import { elementLines, keyColumn } from "./jsx";
import { findStyleSource, readText } from "./source";
import { findProjectionSource } from "./spawn";
import { type IdentSource, loadBlock } from "./styles";

/**
 * The characters a component value keeps before it is cut with "…".
 */
const SHORT_VALUE = 48;

/**
 * A component value on one line: the Styles list's text, cut at 48 characters.
 *
 * @param value - A component value.
 * @returns The text.
 * @example
 * ```ts
 * shortValue({ name: "items" }); // "name items"
 * ```
 */
export function shortValue(value: Json): string {
  const text = styleValue(value);
  return text.length > SHORT_VALUE ? `${text.slice(0, SHORT_VALUE)}…` : text;
}

/**
 * The source of a ui key: remembered, else the search (the one in flight when there is one).
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns The source, undefined when none is found or the search failed.
 */
async function sourceOfKey(ctx: GameViewCtx, key: string): Promise<StyleSource | undefined> {
  try {
    return ctx.state.found.get(key) ?? (await findStyleSource(ctx, key));
  } catch {
    return undefined;
  }
}

/**
 * The JSX of the element whose key the source found.
 *
 * @param ctx - Domain context of gameView.
 * @param source - Where the key is.
 * @param key - The ui key.
 * @returns The element's lines, undefined when the file cannot be read.
 */
async function jsxOf(
  ctx: GameViewCtx,
  source: StyleSource,
  key: string
): Promise<CodeSnippet | undefined> {
  const text = await readText(ctx, source.path);
  if (text === undefined) return undefined;
  const lines = text.split("\n");
  const range = elementLines(lines, source.line, keyColumn(lines[source.line - 1] ?? "", key));
  return { path: source.path, line: range.start, lines: lines.slice(range.start - 1, range.end) };
}

/**
 * The `defineStyle` block of `style={ident}`.
 *
 * @param ctx - Domain context of gameView.
 * @param source - The identifier source.
 * @returns The block's lines with its name, undefined when no candidate file has it.
 */
async function styleOf(ctx: GameViewCtx, source: IdentSource): Promise<StyleSnippet | undefined> {
  try {
    const result = await loadBlock(ctx, source);
    if ("error" in result) return undefined;
    const { path, loaded, block } = result;
    const lines = loaded.text.split("\n").slice(block.line - 1, block.endLine);
    return { path, line: block.line, lines, name: source.ref.name };
  } catch {
    return undefined;
  }
}

/**
 * The components of an entity with their values from the raw `game.entities` ("" for a
 * component the game sent without a JSON value, or an entity it did not send).
 *
 * @param entities - The game.entities value.
 * @param id - The entity id.
 * @param names - Its component names, in order.
 * @returns One row per component.
 */
function componentsOf(
  entities: Json | undefined,
  id: number,
  names: readonly string[]
): readonly ComponentRow[] {
  const raw = Array.isArray(entities)
    ? entities.find(entity => isObject(entity) && entity.id === id)
    : undefined;
  const components = isObject(raw) && isObject(raw.components) ? raw.components : {};
  return names.map(name => {
    const value = components[name];
    return { name, value: value === undefined ? "" : shortValue(value) };
  });
}

/**
 * The code of a picked element: a ui element's JSX and style block, an entity's projection, its
 * definition and its components.
 *
 * @param ctx - Domain context of gameView.
 * @param node - The scene node.
 * @returns The code, undefined for an unkeyed ui node, a key no source names, or an entity
 * without an owner.
 */
export async function elementCode(
  ctx: GameViewCtx,
  node: SceneNode
): Promise<ElementCode | undefined> {
  const { entity } = node;
  if (entity !== undefined) {
    const spawn = await findProjectionSource(ctx, entity.owner);
    const components = componentsOf(ctx.state.sources.entities, entity.id, entity.components);
    return { kind: "entity", projection: entity.owner, spawn, components };
  }
  if (node.key === undefined) return undefined;

  const source = await sourceOfKey(ctx, node.key);
  if (source === undefined) return undefined;
  const [jsx, style] = await Promise.all([
    jsxOf(ctx, source, node.key),
    source.kind === "ident" ? styleOf(ctx, source) : undefined
  ]);
  return { kind: "ui", jsx, style };
}
