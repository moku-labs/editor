/**
 * @file gameView plugin — pending style edits on the state (U8, D-67): `editStyle` records an
 * edit of the selected element (`from` is the value the scene has), `clearEdits` drops them,
 * `listEdits` lists them with the selected element first and `copyEdits` puts the agent text on
 * the clipboard. An edit resolves by itself: a new scene snapshot that shows its `to` value drops
 * it (`resolveEdits`), and a new game session drops the entries kept by node id
 * (`dropSessionEdits`). Every change of the selected element's edits publishes the selection
 * again. The game does not change: no file is written and no command is sent.
 */
import type { SceneNode, SceneSnapshot } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type { StyleEdit, StyleValue } from "../../registry/protocol";
import { copyText } from "../clipboard";
import { notify } from "../state";
import type { ElementEdits, GameViewCtx, GameViewState } from "../types";
import {
  editCountText,
  editKey,
  editsText,
  selectedEditKey,
  styleValueAt,
  unresolved,
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

  const key = editKey(node);
  const before = state.edits.get(key)?.edits ?? [];
  const after = withEdit(before, path, now, to);
  if (after === before) return;

  keep(state, key, entryOf(state, node, after));
  publishEdits(ctx);
  notify(state);
}

/**
 * Drops the pending edits of the selected element, or all of them; the selection is published
 * again when the selected element lost some.
 *
 * @param ctx - Domain context of gameView.
 * @param scope - `"selected"` or `"all"`.
 */
export function clearEdits(ctx: GameViewCtx, scope: "selected" | "all" = "all"): void {
  const { state } = ctx;
  if (state.edits.size === 0) return;

  const selected = selectedEditKey(state);
  const hadSelected = selected !== undefined && state.edits.has(selected);
  if (scope === "selected" && !hadSelected) return;

  // Drop first, then publish: the selection goes out again only when its element lost edits.
  if (scope === "all") state.edits.clear();
  else if (selected !== undefined) state.edits.delete(selected);
  if (hadSelected) publishEdits(ctx);
  notify(state);
}

/**
 * Every pending edit, one entry per element, the selected element first. A keyed element names
 * the source the index answers now (the line may have moved since the edit was made).
 *
 * @param ctx - Domain context of gameView.
 * @returns A copy of the list.
 */
export function listEdits(ctx: Pick<GameViewCtx, "state">): readonly ElementEdits[] {
  const { state } = ctx;
  const selected = selectedEditKey(state);
  const first: ElementEdits[] = [];
  const rest: ElementEdits[] = [];

  // A keyed entry takes the source the index answers now, not the one kept with the edit.
  for (const [key, entry] of state.edits) {
    const found = entry.byId ? undefined : state.found.get(key);
    const listed = found === undefined ? entry : { ...entry, source: sourceAt(found) };
    (key === selected ? first : rest).push(listed);
  }

  return [...first, ...rest];
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
 * kept by node id are not in it: the scene answers those by id.
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
  for (const [key, entry] of edits) if (!entry.byId) wanted.add(key);

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
 * forgotten. The selection is published again when the selected element lost an edit.
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
