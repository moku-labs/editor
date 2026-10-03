/**
 * @file gameView plugin — the layout style card of the selected element (C7): the block found
 * through element/source and the shared style edit (panels/shared/style-edit, R4, R8), steppers
 * bounded only by `fieldRule`, one debounced `writeNumber` per burst (version checked, one retry
 * on a conflict), then a toast and the D-07 reload with restore. A refusal writes nothing.
 */
import { linkPlugin } from "../../link";
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
  stepValue,
  writeNumber
} from "../../panels/shared/style-edit";
import { workspacePlugin } from "../../workspace";
import { messageOf, reportFailure } from "../report";
import { reloadGame } from "../stage/reload";
import { notify } from "../state";
import type { GameViewCtx, GameViewState } from "../types";
import { findStyleSource, type StyleSource } from "./source";

/**
 * Debounce of a stepper burst before the one write.
 */
const STYLE_SAVE_MS = 400;

/**
 * A block found in one of the candidate files, or the refusal to show.
 */
type BlockResult =
  | { readonly path: string; readonly loaded: LoadedStyleFile; readonly block: StyleBlock }
  | { readonly path: string; readonly error: StyleEditError };

/**
 * True while the element is still the selected one.
 *
 * @param state - gameView state.
 * @param ref - The element the work started for.
 * @returns Whether the selection is unchanged.
 * @example
 * ```ts
 * isSelected(ctx.state, { kind: "ui", path: "boardScreen/hudRow/coinPill" }); // true right after select
 * ```
 */
function isSelected(state: GameViewState, ref: ElementRef): boolean {
  return state.selected !== undefined && refId(state.selected) === refId(ref);
}

/**
 * Loads the block of a const ref from the candidate files in order: the key file, then the files
 * the ident is imported from. The first real refusal is kept for the card.
 *
 * @param ctx - Domain context of gameView.
 * @param source - Where the key was found.
 * @returns The file and block, or the refusal.
 * @example
 * ```ts
 * await loadBlock(ctx, source); // { path: "src/hud/styles.ts", loaded, block: { line: 3, endLine: 8, … } }
 * ```
 */
async function loadBlock(ctx: GameViewCtx, source: StyleSource): Promise<BlockResult> {
  const files = ctx.require(linkPlugin).files;
  let refusal: BlockResult | undefined;
  for (const path of source.files) {
    const loaded = await loadStyleFile(files, path);
    const block = isStyleEditError(loaded) ? loaded : findBlock(loaded.file, source.ref);
    if (!isStyleEditError(loaded) && !isStyleEditError(block)) return { path, loaded, block };
    if (isStyleEditError(block) && block.error !== "no-file") refusal ??= { path, error: block };
  }
  return refusal ?? { path: source.path, error: { error: "no-file", path: source.path } };
}

/**
 * Shows the found block, or the refusal, unless the selection changed meanwhile.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The element.
 * @param key - Its ui key.
 * @param result - The block result.
 * @example
 * ```ts
 * applyBlock(ctx, ref, "coinPill", result);
 * ```
 */
function applyBlock(ctx: GameViewCtx, ref: ElementRef, key: string, result: BlockResult): void {
  const { state } = ctx;
  if (!isSelected(state, ref)) return;
  if ("error" in result) {
    state.lookup = { key, status: "failed", path: result.path, error: result.error };
  } else {
    const { path, loaded, block } = result;
    state.lookup = undefined;
    state.styles = {
      path,
      current: { text: loaded.text, version: loaded.version },
      ref: block.ref,
      block,
      pending: undefined,
      error: undefined
    };
  }
  notify(state);
}

/**
 * Finds and shows the layout style card of a ui element with a key; anything else has none.
 *
 * @param ctx - Domain context of gameView.
 * @param ref - The selected element.
 * @returns Resolves when the card, "missing" or the refusal is shown.
 * @example
 * ```ts
 * await openStyleCard(ctx, { kind: "ui", path: "boardScreen/hudRow/coinPill" }); // ctx.state.styles.path === "src/hud/styles.ts"
 * ```
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
    if (source === undefined) {
      if (isSelected(state, ref)) state.lookup = { key, status: "missing" };
      notify(state);
      return;
    }
    applyBlock(ctx, ref, key, await loadBlock(ctx, source));
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
 * @example
 * ```ts
 * await saveStyle(ctx); // toast "✓ Saved · src/hud/styles.ts", game reloads with restore
 * ```
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
    const target = { ref: card.ref, path: pending.path, raw: pending.raw };
    const files = ctx.require(linkPlugin).files;
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
    await reloadGame(ctx, true);
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
 * @example
 * ```ts
 * stepStyle(ctx, "height", 1, false); // pending { path: "height", raw: "76", next: 77 }
 * ```
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
 * gameView's one line for a refusal of the shared style edit.
 *
 * @param error - The refusal.
 * @returns The text the card shows next to "Open in Files".
 * @example
 * ```ts
 * styleErrorText({ error: "no-key", key: "coinPill" }); // "No style block named coinPill."
 * ```
 */
export function styleErrorText(error: StyleEditError): string {
  switch (error.error) {
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
