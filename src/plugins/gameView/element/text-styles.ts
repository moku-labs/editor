/**
 * @file gameView plugin — the text style key of a text node (round 2b R17, D-73). A text node
 * with `style="ui.link"` names a key of the game's text-style table, and the project index
 * answers where that key is (`find("textStyle:<key>")`): the lines of its range for the Code
 * section (`textStyleOf`), and the fields of its block for the Text style section of the Element
 * tab (`openTextStyle`), parsed by the shared style edit. The key is the one the engine sends for
 * the node (`SceneNode.textStyle`). Every read of a block resolves the pending edits of its key,
 * and a project change that touches its file reads it again (`refreshTextStyles`). Nothing here
 * throws: what the index does not know or what cannot be read is left out.
 */
import { linkPlugin } from "../../link";
import { findFresh } from "../../panels/shared/project";
import { refId } from "../../panels/shared/scene";
import type { StyleBlock, StyleField } from "../../panels/shared/style-edit";
import { findBlock, isStyleEditError, parseStyleFile } from "../../panels/shared/style-edit";
import type { ProjectDelta } from "../../registry/protocol";
import { messageOf } from "../report";
import { notify } from "../state";
import type {
  GameViewCtx,
  GameViewState,
  StyleSnippet,
  TextStyleCard,
  TextStyleRow
} from "../types";
import { resolveTextStyleEdits } from "./edit-style";
import { textStyleKeyOf } from "./edits";
import { snippetOf } from "./jsx";

/**
 * A string literal on one line without an escape: `"center"` or `'center'`. Its text is the
 * first or the second group.
 */
const QUOTED = /^"([^"\\\n]*)"$|^'([^'\\\n]*)'$/;

/**
 * The block of a text style key: its lines with the key as its name.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The text style key ("ui.link").
 * @returns The block, undefined when the index has no answer or its file cannot be read.
 */
export async function textStyleOf(
  ctx: GameViewCtx,
  key: string
): Promise<StyleSnippet | undefined> {
  const fresh = await findFresh(ctx.require(linkPlugin).files, `textStyle:${key}`);
  if (fresh === undefined) return undefined;
  const { found, text } = fresh;
  return { ...snippetOf(found.path, text, found.range), name: key };
}

/**
 * The value a field of the Text style section edits: the number of a number literal, the text of
 * a quoted string.
 *
 * @param field - A field of a text style block.
 * @returns The value, undefined for anything else (an identifier, a boolean, a call).
 * @example
 * ```ts
 * editableOf({ kind: "other", path: "align", raw: '"center"', line: 91 }); // "center"
 * editableOf({ kind: "other", path: "fill", raw: "colors.cream", line: 90 }); // undefined
 * ```
 */
function editableOf(field: StyleField): number | string | undefined {
  if (field.kind === "number") return field.value;
  const quoted = QUOTED.exec(field.raw);
  return quoted?.[1] ?? quoted?.[2];
}

/**
 * The rows of a text style block: one per field, in source order. A number and a quoted string
 * carry the value a field edits; anything else is read-only and keeps its source text.
 *
 * @param block - A block of the shared style edit (`findBlock`, kind text).
 * @returns The rows.
 * @example
 * ```ts
 * // `"ui.button": { font, size: 105, fill: colors.cream, shadow: { color: creamShade, dy: 6 } }`
 * rowsOf(block);
 * // [{ path: "font", raw: "font", value: undefined }, { path: "size", raw: "105", value: 105 },
 * //  { path: "fill", raw: "colors.cream", value: undefined },
 * //  { path: "shadow.color", raw: "creamShade", value: undefined }, { path: "shadow.dy", raw: "6", value: 6 }]
 * ```
 */
export function rowsOf(block: StyleBlock): readonly TextStyleRow[] {
  return block.fields.map(field => ({
    path: field.path,
    raw: field.raw,
    value: editableOf(field)
  }));
}

/**
 * The block of a key in the text of a text styles file. When two entries of the file have the
 * key (another table quotes it too), the one on the line the index answers.
 *
 * @param text - The file text.
 * @param key - The text style key.
 * @param line - The 1-based line the index answers for the key.
 * @returns The block, undefined when the file does not parse or no entry is read for the key.
 * @example
 * ```ts
 * blockIn('defineTextStyles({\n  "ui.link": { size: 40 }\n});', "ui.link", 2)?.line; // 2
 * ```
 */
function blockIn(text: string, key: string, line: number): StyleBlock | undefined {
  const file = parseStyleFile(text);
  if (isStyleEditError(file)) return undefined;

  const block = findBlock(file, { kind: "text", key });
  if (!isStyleEditError(block)) return block;
  return file.blocks.find(
    entry => entry.ref.kind === "text" && entry.ref.key === key && entry.line === line
  );
}

/**
 * Asks the index for a text style key and reads its block.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The text style key.
 * @returns The block with its rows (none when it cannot be parsed), or `missing` when the index
 * has no answer or the file cannot be read.
 */
async function readTextStyle(ctx: GameViewCtx, key: string): Promise<TextStyleCard> {
  const fresh = await findFresh(ctx.require(linkPlugin).files, `textStyle:${key}`);
  if (fresh === undefined) return { key, status: "missing" };

  const { found, text, version } = fresh;
  const block = blockIn(text, key, found.line);
  return {
    key,
    status: "found",
    path: found.path,
    line: block?.line ?? found.line,
    version,
    rows: block === undefined ? [] : rowsOf(block)
  };
}

/**
 * The text style key of the selected element in the scene.
 *
 * @param state - The selection and the scene.
 * @returns The key, undefined for an entity, a node without one, or no selection.
 */
function selectedTextStyle(state: Pick<GameViewState, "selected" | "scene">): string | undefined {
  const { selected, scene } = state;
  return selected?.kind === "ui" ? scene?.nodes.get(refId(selected))?.textStyle : undefined;
}

/**
 * Reads the block of a key, resolves the pending edits of the key against it and shows it while
 * a text node with the key is selected. A failure is a warning and shows the key as not found.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The text style key.
 */
async function loadTextStyle(ctx: GameViewCtx, key: string): Promise<void> {
  const { state } = ctx;
  let card: TextStyleCard = { key, status: "missing" };
  try {
    card = await readTextStyle(ctx, key);
    if (card.status === "found") resolveTextStyleEdits(ctx, card);
  } catch (error) {
    ctx.log.warn("gameView: text style failed", { key, message: messageOf(error) });
  }
  if (selectedTextStyle(state) === key) state.textStyle = card;
  notify(state);
}

/**
 * Shows the text style block of the selected element (D-73): asks the index for the key the
 * engine sent for the node and reads its block. An element without a text style key has none.
 * The rows of the same key stay while its block is read again (another text of the key).
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when the block, or that the index does not know the key, is shown.
 */
export async function openTextStyle(ctx: GameViewCtx): Promise<void> {
  const { state } = ctx;
  const key = selectedTextStyle(state);
  if (key === undefined) {
    if (state.textStyle === undefined) return;
    state.textStyle = undefined;
    notify(state);
    return;
  }

  if (state.textStyle?.key !== key) {
    state.textStyle = { key, status: "searching" };
    notify(state);
  }
  await loadTextStyle(ctx, key);
}

/**
 * True when a batch made what is shown of the selected text node's key stale: a gap, a change of
 * the file of its block, or a key the index did not know before.
 *
 * @param card - The text style block shown.
 * @param delta - The delta of the project change.
 * @param changed - The files the batch touched.
 * @returns Whether to read the block again.
 * @example
 * ```ts
 * isCardStale({ key: "ui.link", status: "missing" }, { all: false, files: [], moved: [], removed: [] }, new Set()); // true
 * ```
 */
function isCardStale(
  card: TextStyleCard,
  delta: ProjectDelta,
  changed: ReadonlySet<string>
): boolean {
  if (delta.all || card.status === "missing") return true;
  return card.status === "found" && changed.has(card.path);
}

/**
 * A project change (D-46): reads again the block of the selected text node's key when the batch
 * made it stale, and the block of every key with pending edits whose file the batch touched, so
 * an edit the agent wrote resolves whatever is selected.
 *
 * @param ctx - Domain context of gameView.
 * @param delta - The delta of the project change.
 * @param changed - The files the batch touched.
 */
export function refreshTextStyles(
  ctx: GameViewCtx,
  delta: ProjectDelta,
  changed: ReadonlySet<string>
): void {
  const { state } = ctx;
  const keys = new Set<string>();

  // The block shown for the selected text node.
  const card = state.textStyle;
  const isShown = card !== undefined && card.key === selectedTextStyle(state);
  if (isShown && isCardStale(card, delta, changed)) keys.add(card.key);

  // The keys with pending edits: their block is where the agent writes.
  for (const [editKey, entry] of state.edits) {
    const key = textStyleKeyOf(editKey);
    const path = entry.source?.path;
    const isTouched = delta.all || path === undefined || changed.has(path);
    if (key !== undefined && isTouched) keys.add(key);
  }

  for (const key of keys) void loadTextStyle(ctx, key);
}
