/**
 * @file gameView plugin — pending style edits on the state (U8, D-67): `editStyle` records an
 * edit of the selected element (`from` is the value the scene has), `clearEdits` drops them,
 * `listEdits` lists them with the selected element first and `copyEdits` puts the agent text on
 * the clipboard. An edit resolves by itself: a new scene snapshot that shows its `to` value drops
 * it (`resolveEdits`), and a new game session drops the entries kept by node id
 * (`dropSessionEdits`). Every change of the selected element's edits publishes the selection
 * again. The game does not change: no file is written and no command is sent.
 *
 * A text style key has pending edits too (D-73): `editTextStyle` records one under
 * `textStyle:<key>` (`from` is the value its block has in the file), `editValue` records for
 * either owner, and the block read again drops the edits it shows and the ones of a field that is
 * no literal any more, and moves `from` to a new file value (`resolveTextStyleEdits`). The list
 * names the keys after the elements.
 */
import type { SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type { StyleEdit, StyleValue } from "../../registry/protocol";
import { copyText } from "../clipboard";
import { notify } from "../state";
import type { ElementEdits, GameViewCtx, GameViewState, TextStyleCard } from "../types";
import {
  type EditOwner,
  editCountText,
  editKey,
  editsText,
  isTextStyleEditKey,
  selectedEditKey,
  styleValueAt,
  textStyleEditKey,
  unresolved,
  unresolvedInBlock,
  withEdit
} from "./edits";
import { publishEdits } from "./publish";
import { sourceAt } from "./selection";

/**
 * The scene node of the selected element.
 *
 * @param state - The selection and the scene.
 * @returns The node, undefined without a selection or when the scene does not have it.
 */
function selectedNode(state: Pick<GameViewState, "selected" | "scene">): SceneNode | undefined {
  const { selected, scene } = state;
  return selected === undefined ? undefined : scene?.nodes.get(refId(selected));
}

/**
 * The entry of a node with its edits: labelled with its ui key, else its name, and with the
 * source the index answered for its key.
 *
 * @param state - The index answers.
 * @param node - The node.
 * @param edits - Its edits.
 * @returns The entry.
 */
function entryOf(
  state: Pick<GameViewState, "found">,
  node: SceneNode,
  edits: readonly StyleEdit[]
): ElementEdits {
  const found = node.key === undefined ? undefined : state.found.get(node.key);
  return {
    label: node.key ?? node.name,
    ...(found === undefined ? {} : { source: sourceAt(found) }),
    byId: node.key === undefined,
    edits
  };
}

/**
 * Keeps the edits of an element, or forgets the element when it has none left.
 *
 * @param state - The pending edits.
 * @param key - The element's key.
 * @param entry - Its entry with the edits that are left.
 */
function keep(state: Pick<GameViewState, "edits">, key: string, entry: ElementEdits): void {
  if (entry.edits.length === 0) state.edits.delete(key);
  else state.edits.set(key, entry);
}

/**
 * The text style block that was read: the `found` state of the card.
 */
type ReadTextStyle = Extract<TextStyleCard, { readonly status: "found" }>;

/**
 * The entry of a text style key with its edits (D-73): labelled `textStyle <key>`, at the place
 * of its block, never by id.
 *
 * @param card - The block of the key as read.
 * @param edits - Its edits.
 * @returns The entry.
 */
function textStyleEntry(card: ReadTextStyle, edits: readonly StyleEdit[]): ElementEdits {
  return {
    label: `textStyle ${card.key}`,
    source: { path: card.path, line: card.line },
    byId: false,
    edits
  };
}

/**
 * Records one edit under a key of the pending edits, publishes the selection again and tells the
 * UI. Nothing happens when the edit changes nothing.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The map key: of an element, or of a text style key.
 * @param edit - The path, the value there is now and the wanted value.
 * @param edit.path - The style path.
 * @param edit.now - The value the scene, or the file, has for the path.
 * @param edit.to - The wanted value.
 * @param entryWith - Builds the entry of the key around its edits.
 */
function record(
  ctx: GameViewCtx,
  key: string,
  edit: { readonly path: string; readonly now: StyleValue; readonly to: StyleValue },
  entryWith: (edits: readonly StyleEdit[]) => ElementEdits
): void {
  const { state } = ctx;
  const before = state.edits.get(key)?.edits ?? [];
  const after = withEdit(before, edit.path, edit.now, edit.to);
  if (after === before) return;

  keep(state, key, entryWith(after));
  publishEdits(ctx);
  notify(state);
}

/**
 * Records a pending style edit of the selected element and publishes the selection again.
 *
 * @param ctx - Domain context of gameView.
 * @param path - The style path (`minWidth`, `padding.top`).
 * @param to - The wanted value.
 */
export function editStyle(ctx: GameViewCtx, path: string, to: StyleValue): void {
  const { state } = ctx;
  const node = selectedNode(state);
  const now = styleValueAt(node?.style, path);
  if (node === undefined || now === undefined) return;

  record(ctx, editKey(node), { path, now, to }, edits => entryOf(state, node, edits));
}

/**
 * Records a pending edit of a text style key (D-73) and publishes the selection again. `from` is
 * the value the block of the key has in the file. Nothing happens unless the block of this key is
 * the one read for the selected text node and the field is a number or a quoted string there.
 *
 * @param ctx - Domain context of gameView.
 * @param key - The text style key ("ui.button").
 * @param path - The field of its block (`size`, `shadow.dy`).
 * @param to - The wanted value.
 */
export function editTextStyle(ctx: GameViewCtx, key: string, path: string, to: StyleValue): void {
  const card = ctx.state.textStyle;
  if (card?.status !== "found" || card.key !== key) return;
  const now = card.rows.find(row => row.path === path)?.value;
  if (now === undefined) return;

  record(ctx, textStyleEditKey(key), { path, now, to }, edits => textStyleEntry(card, edits));
}

/**
 * Records a pending edit for its owner: the selected element, or a text style key. The fields of
 * the Element tab commit through it.
 *
 * @param ctx - Domain context of gameView.
 * @param owner - What the edit belongs to.
 * @param path - The style path, or the field of the text style block.
 * @param to - The wanted value.
 */
export function editValue(ctx: GameViewCtx, owner: EditOwner, path: string, to: StyleValue): void {
  if (owner.kind === "textStyle") editTextStyle(ctx, owner.key, path, to);
  else editStyle(ctx, path, to);
}

/**
 * The keys the pending edits of the selected element are kept under: its own and, for a text
 * node, the one of its text style key (D-73).
 *
 * @param state - The selection, the scene and the selection published last.
 * @returns The keys, none without a selection.
 */
function selectedEditKeys(
  state: Pick<GameViewState, "selected" | "scene" | "selection">
): readonly string[] {
  const own = selectedEditKey(state);
  const textStyle = selectedNode(state)?.textStyle;
  return [
    ...(own === undefined ? [] : [own]),
    ...(textStyle === undefined ? [] : [textStyleEditKey(textStyle)])
  ];
}

/**
 * Drops the pending edits of the selected element (its own and the ones of its text style key),
 * or all of them; the selection is published again when the selected element lost some.
 *
 * @param ctx - Domain context of gameView.
 * @param scope - `"selected"` or `"all"`.
 */
export function clearEdits(ctx: GameViewCtx, scope: "selected" | "all" = "all"): void {
  const { state } = ctx;
  if (state.edits.size === 0) return;

  const selected = selectedEditKeys(state).filter(key => state.edits.has(key));
  if (scope === "selected" && selected.length === 0) return;

  // Drop first, then publish: the selection goes out again only when its element lost edits.
  if (scope === "all") state.edits.clear();
  else for (const key of selected) state.edits.delete(key);
  if (selected.length > 0) publishEdits(ctx);
  notify(state);
}

/**
 * Every pending edit, one entry per element, the selected element first, then one entry per text
 * style key (D-73). A keyed element names the source the index answers now (the line may have
 * moved since the edit was made).
 *
 * @param ctx - Domain context of gameView.
 * @returns A copy of the list.
 */
export function listEdits(ctx: Pick<GameViewCtx, "state">): readonly ElementEdits[] {
  const { state } = ctx;
  const selected = selectedEditKey(state);
  const first: ElementEdits[] = [];
  const rest: ElementEdits[] = [];
  const textStyles: ElementEdits[] = [];

  for (const [key, entry] of state.edits) {
    // A text style key: its place is the one of its block, kept fresh by every read of it.
    if (isTextStyleEditKey(key)) {
      textStyles.push(entry);
      continue;
    }

    // A keyed entry takes the source the index answers now, not the one kept with the edit.
    const found = entry.byId ? undefined : state.found.get(key);
    const listed = found === undefined ? entry : { ...entry, source: sourceAt(found) };
    (key === selected ? first : rest).push(listed);
  }

  return [...first, ...rest, ...textStyles];
}

/**
 * "Copy for agent": the text of every pending edit on the clipboard, with a toast.
 *
 * @param ctx - Domain context of gameView.
 * @returns The text; undefined without edits or when the clipboard refused (toasted).
 */
export async function copyEdits(ctx: GameViewCtx): Promise<string | undefined> {
  const list = listEdits(ctx);
  if (list.length === 0) return undefined;
  const text = editsText(list);
  const copied = await copyText(ctx, text, `✓ ${editCountText(list)} copied`);
  return copied ? text : undefined;
}

/**
 * The first node of every ui key the pending edits hold, from one pass over a scene. The entries
 * kept by node id are not in it: the scene answers those by id. Neither are the text style keys:
 * no node answers them.
 *
 * @param scene - The scene.
 * @param edits - The pending edits.
 * @returns Ui key → node, without the keys the scene does not have.
 */
function keyedNodes(
  scene: SceneSnapshot,
  edits: ReadonlyMap<string, ElementEdits>
): ReadonlyMap<string, SceneNode> {
  const wanted = new Set<string>();
  for (const [key, entry] of edits) {
    if (!entry.byId && !isTextStyleEditKey(key)) wanted.add(key);
  }

  // A found key leaves `wanted`, so the first node of a key wins and the pass ends early.
  const byKey = new Map<string, SceneNode>();
  for (const node of scene.nodes.values()) {
    if (wanted.size === 0) break;
    if (node.key === undefined || !wanted.delete(node.key)) continue;
    byKey.set(node.key, node);
  }
  return byKey;
}

/**
 * The self-resolve of the pending edits on a new scene snapshot: for every element the scene
 * has, an edit whose scene value equals its `to` is dropped; an element without edits left is
 * forgotten. The selection is published again when the selected element lost an edit. The edits
 * of a text style key stay: the scene has no value of a text style (`resolveTextStyleEdits`).
 *
 * @param ctx - Domain context of gameView.
 * @param scene - The new scene.
 */
export function resolveEdits(ctx: GameViewCtx, scene: SceneSnapshot): void {
  const { state } = ctx;
  if (state.edits.size === 0) return;
  const selected = selectedEditKey(state);
  let isSelectedChanged = false;

  const keyed = keyedNodes(scene, state.edits);
  for (const [key, entry] of state.edits) {
    const node = entry.byId ? scene.nodes.get(key) : keyed.get(key);
    if (node === undefined) continue;
    const left = unresolved(entry.edits, node.style);
    if (left === entry.edits) continue;
    keep(state, key, { ...entry, edits: left });
    if (key === selected) isSelectedChanged = true;
  }
  if (isSelectedChanged) publishEdits(ctx);
}

/**
 * The self-resolve of the pending edits of a text style key on a read of its block (D-73): an
 * edit whose field has its `to` value in the file is dropped (the agent wrote the code), and so is
 * an edit whose field is no literal row of the block any more (a token now, or gone); an edit
 * whose field has another value takes it as `from`; a key without edits left is forgotten. A block
 * that cannot be parsed (no rows) keeps every edit. The entry follows the place of the block. The
 * selection is published again when the selected text node has the key and an edit of it changed
 * or left.
 *
 * @param ctx - Domain context of gameView.
 * @param card - The block of the key as read.
 */
export function resolveTextStyleEdits(ctx: GameViewCtx, card: ReadTextStyle): void {
  const { state } = ctx;
  const key = textStyleEditKey(card.key);
  const entry = state.edits.get(key);
  if (entry === undefined) return;

  const left = unresolvedInBlock(entry.edits, card.rows);
  keep(state, key, textStyleEntry(card, left));
  if (left !== entry.edits && selectedNode(state)?.textStyle === card.key) publishEdits(ctx);
}

/**
 * A new game session: the entries kept by node id are dropped (the ids of the new page are not
 * the old ones); the keyed ones stay. The selection is published again when the selected element
 * lost its edits.
 *
 * @param ctx - Domain context of gameView.
 */
export function dropSessionEdits(ctx: GameViewCtx): void {
  const { state } = ctx;
  const selected = selectedEditKey(state);
  let isSelectedChanged = false;

  for (const [key, entry] of state.edits) {
    if (!entry.byId) continue;
    state.edits.delete(key);
    if (key === selected) isSelectedChanged = true;
  }
  if (isSelectedChanged) publishEdits(ctx);
}
