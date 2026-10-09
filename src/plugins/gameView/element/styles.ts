/**
 * @file gameView plugin — the layout style card of the selected element (C7): the block found
 * through element/source (the project index) and the shared style edit
 * (panels/shared/style-edit, R4, R8), steppers bounded only by `fieldRule`, one debounced
 * `writeNumber` per burst (version checked, one retry on a conflict, refused as `broken` while the
 * index says the file does not parse, D-44, or as `index-off` while it is off, D-48), then a toast
 * and the D-07 reload with restore. A refusal writes nothing. The block is a `defineStyle` const
 * (`style={ident}`), or the `defineStyle({ … })` call a style function makes (`style={fn(…)}`
 * whose `style:` key the index knows, G2), found at the place the index answers.
 */
import { linkPlugin } from "../../link";
import { findAllFresh, projectOffText } from "../../panels/shared/project";
import type { ElementRef } from "../../panels/shared/scene";
import { refId } from "../../panels/shared/scene";
import type {
  LoadedStyleFile,
  StyleBlock,
  StyleBlockRef,
  StyleEditError
} from "../../panels/shared/style-edit";
import {
  fieldRule,
  findBlock,
  isStyleEditError,
  loadStyleFile,
  parseStyleFile,
  STYLE_BROKEN_TEXT,
  stepValue,
  writeNumber
} from "../../panels/shared/style-edit";
import type { ProjectState } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { messageOf, reportFailure } from "../report";
import { reloadGame } from "../stage/reload";
import { notify } from "../state";
import type { BlockAt, GameViewCtx, GameViewState, StyleLookup, StyleSource } from "../types";
import { findStyleSource, stylePathOf } from "./source";

/**
 * Debounce of a stepper burst before the one write.
 */
const STYLE_SAVE_MS = 400;

/**
 * An index answer with `style={ident}`: the block lives in one of its files.
 */
export type IdentSource = Extract<StyleSource, { readonly kind: "ident" }>;

/**
 * A block found in one of the candidate files, or the refusal to show.
 */
export type BlockResult =
  | { readonly path: string; readonly loaded: LoadedStyleFile; readonly block: StyleBlock }
  | { readonly path: string; readonly error: StyleEditError };

/**
 * True while the element is still the selected one.
 *
 * @param state - gameView state.
 * @param ref - The element the work started for.
 * @returns Whether the selection is unchanged.
 */
function isSelected(state: GameViewState, ref: ElementRef): boolean {
  return state.selected !== undefined && refId(state.selected) === refId(ref);
}

/**
 * The `broken` refusal of a file the project index says does not parse now (D-44).
 *
 * @param ctx - Domain context of gameView.
 * @param path - A root-relative file.
 * @returns `{ error: "broken", path }`, undefined while the file parses or the index is off.
 */
export function brokenError(ctx: GameViewCtx, path: string): StyleEditError | undefined {
  const project = ctx.require(linkPlugin).project();
  const isBroken = project?.state === "on" && Object.hasOwn(project.broken, path);
  return isBroken ? { error: "broken", path } : undefined;
}

/**
 * Loads the block of a const ref from the candidate files in order: the files the index defines
 * the style in, the file of the style first. The first real refusal is kept for the card.
 *
 * @param ctx - Domain context of gameView.
 * @param source - Where the key was found.
 * @returns The file and block, or the refusal.
 */
export async function loadBlock(ctx: GameViewCtx, source: IdentSource): Promise<BlockResult> {
  const files = ctx.require(linkPlugin).files;
  let refusal: BlockResult | undefined;
  for (const path of source.files) {
    const loaded = await loadStyleFile(files, path);
    const block = isStyleEditError(loaded) ? loaded : findBlock(loaded.file, source.ref);
    if (!isStyleEditError(loaded) && !isStyleEditError(block)) return { path, loaded, block };
    if (isStyleEditError(block) && block.error !== "no-file") refusal ??= { path, error: block };
  }
  const path = stylePathOf(source);
  return refusal ?? { path, error: { error: "no-file", path } };
}

/**
 * Loads the block of a style a function builds (G2): every answer of its `style:` key in the file
 * of the first one, as a call ref at the answer's range start; the first call with an object to
 * edit is the block. `#<function>` answers each call of the function, `#<function>.<property>`
 * the one call of that property.
 *
 * @param ctx - Domain context of gameView.
 * @param styleKey - `style:<file>#<function>[.<property>]`.
 * @returns The file and block, the refusal (`no-key` when no call has an object), or undefined
 * when the index has no answer.
 */
async function loadCallBlock(ctx: GameViewCtx, styleKey: string): Promise<BlockResult | undefined> {
  const fresh = await findAllFresh(ctx.require(linkPlugin).files, styleKey);
  if (fresh === undefined) return undefined;

  const { answers, text, version } = fresh;
  const { path } = answers[0];
  const file = parseStyleFile(text);
  if (isStyleEditError(file)) return { path, error: file };

  const name = styleKey.slice(styleKey.lastIndexOf("#") + 1);
  for (const found of answers) {
    const [line, column] = found.range;
    const block = findBlock(file, { kind: "call", name, line, column });
    if (!isStyleEditError(block)) return { path, loaded: { text, version, file }, block };
  }
  return { path, error: { error: "no-key", key: name } };
}

/**
 * The block of a style call the index knows (G2): the card to edit, or the refusal to show.
 * A call without such a block stays the read-only call card.
 *
 * @param ctx - Domain context of gameView.
 * @param source - Where the key was found.
 * @returns The block result, undefined for another source, a call the index has no answer for,
 * or a call with no object to edit.
 */
async function callBlockOf(
  ctx: GameViewCtx,
  source: StyleSource | undefined
): Promise<BlockResult | undefined> {
  if (source?.kind !== "call" || source.styleKey === undefined) return undefined;

  const result = await loadCallBlock(ctx, source.styleKey);
  const hasNoBlock = result !== undefined && "error" in result && result.error.error === "no-key";
  return hasNoBlock ? undefined : result;
}

/**
 * Remembers where the block of the key is (the reference block and the proxies read it), then
 * shows the found block, or the refusal, unless the selection changed meanwhile. A file the index
 * says does not parse now shows the `broken` text, on the card or instead of the refusal.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element.
 * @param key - Its ui key.
 * @param result - The block result.
 */
function applyBlock(ctx: GameViewCtx, ref: ElementRef, key: string, result: BlockResult): void {
  const { state } = ctx;
  if (!("error" in result)) state.blocks.set(key, { path: result.path, line: result.block.line });
  if (!isSelected(state, ref)) return;
  if ("error" in result) {
    const error = brokenError(ctx, result.path) ?? result.error;
    state.lookup = { key, status: "failed", path: result.path, error };
  } else {
    const { path, loaded, block } = result;
    state.lookup = undefined;
    state.styles = {
      path,
      current: { text: loaded.text, version: loaded.version },
      ref: block.ref,
      block,
      pending: undefined,
      error: brokenError(ctx, path)
    };
  }
  notify(state);
}

/**
 * Where the style block of an identifier source is: remembered from an earlier load, else loaded
 * from its candidate files now (and remembered).
 *
 * @param ctx - Domain context of gameView.
 * @param key - The ui key.
 * @param source - The index answer with `style={ident}`.
 * @returns The file and line of the block, undefined when no candidate file has it.
 */
export async function blockOf(
  ctx: GameViewCtx,
  key: string,
  source: IdentSource
): Promise<BlockAt | undefined> {
  const known = ctx.state.blocks.get(key);
  if (known !== undefined) return known;

  const result = await loadBlock(ctx, source);
  if ("error" in result) return undefined;
  const at = { path: result.path, line: result.block.line };
  ctx.state.blocks.set(key, at);
  return at;
}

/**
 * What the style section says for a source without an editable block: the call (read-only, at
 * the line of the call), the line that defines the key, or that the index has no answer.
 *
 * @param key - The ui key.
 * @param source - The index answer, undefined when the index does not know the key.
 * @returns The lookup to show.
 * @example
 * ```ts
 * lookupOf("cardRow", { kind: "defined", path: "features/ui/view.tsx", line: 51, range: [51, 5, 54, 11] }); // { key: "cardRow", status: "defined", path: "features/ui/view.tsx", line: 51 }
 * ```
 */
function lookupOf(key: string, source: Exclude<StyleSource, IdentSource> | undefined): StyleLookup {
  if (source === undefined) return { key, status: "missing" };
  if (source.kind === "call") {
    const { call, callLine } = source;
    return { key, status: "call", path: stylePathOf(source), line: callLine, call };
  }
  return { key, status: "defined", path: source.path, line: source.line };
}

/**
 * Finds and shows the layout style card of a ui element with a key; anything else has none.
 * A style a function builds is a card at its `defineStyle` call when the index knows the
 * function's key and the call has an object (G2); another call shows read-only; an element
 * without a style shows where it is defined; a key the index does not know shows "missing".
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The selected element.
 * @returns Resolves when the card, the call, the definition, "missing" or the refusal is shown.
 */
export async function openStyleCard(ctx: GameViewCtx, ref: ElementRef): Promise<void> {
  const { state } = ctx;
  const key = ref.kind === "ui" ? state.scene?.nodes.get(refId(ref))?.key : undefined;
  state.styles = undefined;
  state.lookup = key === undefined ? undefined : { key, status: "searching" };
  notify(state);
  if (key === undefined) return;

  try {
    const source = await findStyleSource(ctx, key);
    if (source?.kind === "ident") {
      applyBlock(ctx, ref, key, await loadBlock(ctx, source));
      return;
    }
    const called = await callBlockOf(ctx, source);
    if (called !== undefined) {
      applyBlock(ctx, ref, key, called);
      return;
    }
    if (isSelected(state, ref)) state.lookup = lookupOf(key, source);
    notify(state);
  } catch (error) {
    ctx.log.warn("gameView: style search failed", { key, message: messageOf(error) });
    if (isSelected(state, ref)) state.lookup = { key, status: "missing" };
    notify(state);
  }
}

/**
 * The block of a ref in a freshly written text (the card follows the file).
 *
 * @param text - The written text.
 * @param ref - The block ref.
 * @returns The block, or undefined when it no longer parses.
 * @example
 * ```ts
 * blockIn("export const a = defineStyle({ gap: 4 });", { kind: "const", name: "a" })?.line; // 1
 * ```
 */
function blockIn(text: string, ref: StyleBlockRef): StyleBlock | undefined {
  const file = parseStyleFile(text);
  const block = isStyleEditError(file) ? file : findBlock(file, ref);
  return isStyleEditError(block) ? undefined : block;
}

/**
 * Writes the pending stepper edit (the end of a burst): one writeNumber with the read version,
 * then the toast and the reload with restore (D-07). A refusal shows on the card.
 *
 * @param ctx - Domain context of gameView.
 * @returns Resolves when written, refused or failed.
 */
export async function saveStyle(ctx: GameViewCtx): Promise<void> {
  const { state } = ctx;
  clearTimeout(state.timers.styleSave);
  delete state.timers.styleSave;
  const card = state.styles;
  const pending = card?.pending;
  if (card === undefined || pending === undefined) return;

  card.pending = undefined;
  try {
    // The moment before the write is where the reload starts to look for the game's hot swap.
    const target = { ref: card.ref, path: pending.path, raw: pending.raw };
    const files = ctx.require(linkPlugin).files;
    const savedAt = Date.now();
    const result = await writeNumber(files, card.path, card.current, target, pending.next);
    if (isStyleEditError(result)) {
      card.error = result;
      notify(state);
      return;
    }
    card.current = { text: result.text, version: result.version };
    card.block = blockIn(result.text, card.ref) ?? card.block;
    card.error = undefined;
    notify(state);
    ctx.require(workspacePlugin).toast("✓ Saved", card.path);
    await reloadGame(ctx, { restore: true, afterSave: true, since: savedAt });
  } catch (error) {
    reportFailure(ctx, "Save failed", "gameView: style save failed", error);
  }
}

/**
 * One stepper press: the next value from the field's rule (a field without a rule is read-only);
 * a burst ends in one write 400 ms after the last press.
 *
 * @param ctx - Domain context of gameView.
 * @param path - The field path ("height", "padding.left").
 * @param direction - 1 up, -1 down.
 * @param big - Shift held (bigStep).
 */
export function stepStyle(ctx: GameViewCtx, path: string, direction: 1 | -1, big: boolean): void {
  const { state } = ctx;
  const card = state.styles;
  const field = card?.block.fields.find(entry => entry.path === path);
  const rule = card === undefined ? undefined : fieldRule(card.ref, path);
  if (card === undefined || field?.kind !== "number" || rule === undefined) return;

  if (card.pending !== undefined && card.pending.path !== path) void saveStyle(ctx);
  const same = card.pending?.path === path ? card.pending : undefined;
  card.pending = {
    path,
    raw: same?.raw ?? field.raw,
    next: stepValue(rule, same?.next ?? field.value, direction, big)
  };
  card.error = undefined;
  notify(state);
  clearTimeout(state.timers.styleSave);
  state.timers.styleSave = setTimeout(() => {
    void saveStyle(ctx);
  }, STYLE_SAVE_MS);
}

/**
 * The text of an `index-off` refusal while link still holds an on state: the off state is on its
 * way, and the card shows its reason once it arrives.
 */
const INDEX_OFF_TEXT = "Project index is off";

/**
 * gameView's one line for a refusal of the shared style edit.
 *
 * @param error - The refusal.
 * @param project - The project state (`link.project()`): why the index is off.
 * @returns The text the card shows next to "Open in Files".
 * @example
 * ```ts
 * styleErrorText({ error: "no-key", key: "coinPill" }, link.project()); // "No style block named coinPill."
 * styleErrorText({ error: "index-off", path: "src/hud/styles.ts" }, { state: "off", reason: "disabled" });
 * // "Project index is off: disabled"
 * ```
 */
export function styleErrorText(error: StyleEditError, project: ProjectState | undefined): string {
  switch (error.error) {
    case "broken": {
      return STYLE_BROKEN_TEXT;
    }
    case "index-off": {
      return projectOffText(project) ?? INDEX_OFF_TEXT;
    }
    case "no-file": {
      return "The style file is gone.";
    }
    case "parse": {
      return `The style file does not parse at line ${error.line ?? 1}.`;
    }
    case "no-key": {
      return `No style block named ${error.key ?? "?"}.`;
    }
    case "ambiguous": {
      return `Two style blocks are named ${error.key ?? "?"}.`;
    }
    case "not-literal": {
      return "This value is not a plain number.";
    }
    case "read-only": {
      return "This field is read-only.";
    }
    case "changed-on-disk": {
      return "The file changed on disk. Nothing was written.";
    }
    case "out-of-range": {
      return "The value is out of range.";
    }
  }
}
