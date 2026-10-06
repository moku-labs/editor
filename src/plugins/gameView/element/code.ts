/**
 * @file gameView plugin — the code of a picked element (round 2b R12) for the Element tab's Code
 * section and the reference card: a ui element's JSX (the range the project index answered for
 * its key) and the `defineStyle` block of `style={ident}` (the style card's loader), the
 * `defineStyle` call a style function builds (`style={call(…)}` with a `style:` key, G2), or the
 * text style key block of a text node's `style="ui.link"` (element/text-styles, round 2b R17); an
 * entity's projection, the line that defines it (element/spawn) and its components with their
 * values from the raw `game.entities`. Nothing here throws: what cannot be read is left out.
 */
import { linkPlugin } from "../../link";
import { findFresh } from "../../panels/shared/project";
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
import { snippetOf } from "./jsx";
import { findStyleSource, readText } from "./source";
import { findProjectionSource } from "./spawn";
import { type IdentSource, loadBlock } from "./styles";
import { textStyleOf } from "./text-styles";

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
 * The source of a ui key: remembered, else the index answer.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @returns The source, undefined when the index has no answer.
 */
async function sourceOfKey(ctx: GameViewCtx, key: string): Promise<StyleSource | undefined> {
  return ctx.state.found.get(key) ?? (await findStyleSource(ctx, key));
}

/**
 * The JSX of the element whose key the index found: the lines of its range.
 *
 * @param ctx - Domain context of gameView.
 * @param source - Where the key is.
 * @returns The element's lines, undefined when the file cannot be read.
 */
async function jsxOf(ctx: GameViewCtx, source: StyleSource): Promise<CodeSnippet | undefined> {
  const text = await readText(ctx, source.path);
  return text === undefined ? undefined : snippetOf(source.path, text, source.range);
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
 * The `defineStyle` call a style function builds (G2): the first answer of its `style:` key, named
 * by the part after `#` (`boardStyle`, `roundStylesOf.icon`).
 *
 * @param ctx - Domain context of gameView.
 * @param styleKey - `style:<file>#<function>[.<property>]`.
 * @returns The call's lines with its name, undefined when the index has no answer.
 */
async function callStyleOf(ctx: GameViewCtx, styleKey: string): Promise<StyleSnippet | undefined> {
  const fresh = await findFresh(ctx.require(linkPlugin).files, styleKey);
  if (fresh === undefined) return undefined;
  const { found, text } = fresh;
  const name = styleKey.slice(styleKey.lastIndexOf("#") + 1);
  return { ...snippetOf(found.path, text, found.range), name };
}

/**
 * The style block of a key source: the `defineStyle` block of `style={ident}`, the `defineStyle`
 * call of a style function the index knows, the text style key block of `style="ui.link"`; none
 * for another call or an element without a style.
 *
 * @param ctx - Domain context of gameView.
 * @param source - Where the key is.
 * @returns The block, undefined when there is none or it cannot be read.
 */
async function styleBlockOf(
  ctx: GameViewCtx,
  source: StyleSource
): Promise<StyleSnippet | undefined> {
  if (source.kind === "ident") return styleOf(ctx, source);
  if (source.kind === "call" && source.styleKey !== undefined) {
    return callStyleOf(ctx, source.styleKey);
  }
  if (source.kind === "defined" && source.textStyle !== undefined) {
    return textStyleOf(ctx, source.textStyle);
  }
  return undefined;
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
 * @returns The code, undefined for an unkeyed ui node or a key the index does not know.
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
  const [jsx, style] = await Promise.all([jsxOf(ctx, source), styleBlockOf(ctx, source)]);
  return { kind: "ui", jsx, style };
}
