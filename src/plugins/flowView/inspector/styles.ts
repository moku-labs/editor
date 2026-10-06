/**
 * @file flowView inspector module — the Styles tab controller over the shared style edit
 * (panels/shared/style-edit, R4, R8): load the text-style cards of the file the project index
 * names, no card chosen until the person picks one, stepper bursts debounced into one
 * version-checked write of one numeric literal (none while the file does not parse, D-44), then
 * the D-07 reload. flowView owns only the texts of the shared error codes.
 */
import { NOT_IN_INDEX_TEXT, projectOffText, textStylesFile } from "../../panels/shared/project";
import type { StyleBlock, StyleEditError } from "../../panels/shared/style-edit";
import {
  fieldRule,
  isStyleEditError,
  loadStyleFile,
  parseStyleFile,
  STYLE_BROKEN_TEXT,
  stepValue,
  writeNumber
} from "../../panels/shared/style-edit";
import type { ProjectState } from "../../registry/protocol";
import { bareMessage } from "../../registry/protocol";
import type { ReloadResult } from "../../workspace/types";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment } from "../types";
import { isWriting } from "./follow";
import type { StylesState } from "./types";

/**
 * flowView's text for a refused style edit (one row per shared code).
 *
 * @param error - The shared error.
 * @param file - The styles file; undefined when the index names none.
 * @param project - The project state (`link.project()`): why there is no styles file.
 * @returns The text shown on the card.
 * @example
 * ```ts
 * styleErrorText({ error: "read-only", path: "lineHeight" }, "features/ui/styles.ts", project); // "lineHeight has no edit rule · edit it in Files"
 * styleErrorText({ error: "no-file" }, undefined, { state: "off", reason: "typescript is not installed" });
 * // "Project index is off: typescript is not installed"
 * ```
 */
export function styleErrorText(
  error: StyleEditError,
  file: string | undefined,
  project: ProjectState | undefined
): string {
  const path = error.path ?? "the field";
  const key = error.key ?? "the style";
  switch (error.error) {
    case "no-file": {
      if (file !== undefined) return `No text styles at ${file}`;
      return projectOffText(project) ?? `${NOT_IN_INDEX_TEXT}: text styles`;
    }
    case "broken": {
      return STYLE_BROKEN_TEXT;
    }
    case "parse": {
      return `Can't read ${file} safely · Open in Files`;
    }
    case "no-key": {
      return `${key} is no longer in ${file} · list refreshed`;
    }
    case "ambiguous": {
      return `${key} appears twice in ${file} · edit it in Files`;
    }
    case "not-literal": {
      return `${path} is not a number literal at ${file}:${error.line ?? 1}`;
    }
    case "read-only": {
      return `${path} has no edit rule · edit it in Files`;
    }
    case "changed-on-disk": {
      return "The file changed on disk · Reload card";
    }
    case "out-of-range": {
      return `${path} is out of range · not written`;
    }
  }
}

/**
 * The text-style blocks of a parsed file.
 *
 * @param blocks - All blocks.
 * @returns Blocks addressed by `{ kind: "text", key }`.
 * @example
 * ```ts
 * textBlocks([
 *   { ref: { kind: "text", key: "ui.title" }, line: 3, endLine: 6, fields: [] },
 *   { ref: { kind: "const", name: "coin" }, line: 9, endLine: 12, fields: [] }
 * ]).length; // 1
 * ```
 */
function textBlocks(blocks: readonly StyleBlock[]): StyleBlock[] {
  return blocks.filter(block => block.ref.kind === "text");
}

/**
 * The keys of text-style blocks.
 *
 * @param blocks - Text blocks.
 * @returns The keys.
 * @example
 * ```ts
 * keysOf([{ ref: { kind: "text", key: "ui.title" }, line: 3, endLine: 6, fields: [] }]); // ["ui.title"]
 * ```
 */
export function keysOf(blocks: readonly StyleBlock[]): string[] {
  return blocks.flatMap(block => (block.ref.kind === "text" ? [block.ref.key] : []));
}

/**
 * The Styles tab with no cards: no text-styles file in the index, or one that cannot be read.
 *
 * @param file - The styles file, if one was found.
 * @param error - Why there are no cards.
 * @returns The slice.
 * @example
 * ```ts
 * emptyStyles(undefined, { error: "no-file" }).blocks; // []
 * ```
 */
function emptyStyles(file: string | undefined, error: StyleEditError): StylesState {
  return {
    file,
    text: "",
    version: "",
    blocks: [],
    key: undefined,
    pending: undefined,
    writing: false,
    result: undefined,
    error
  };
}

/**
 * What a read of the text styles found: the file the index names and its load.
 */
type StylesRead = {
  readonly file: string | undefined;
  readonly loaded: Awaited<ReturnType<typeof loadStyleFile>> | undefined;
};

/**
 * Reads the text-styles file the project index names; nothing is read when it names none.
 *
 * @param env - Services and actions.
 * @returns The file and its load.
 */
async function readStyles(env: FlowEnvironment): Promise<StylesRead> {
  const file = textStylesFile(env.project());
  const loaded = file === undefined ? undefined : await loadStyleFile(env.files(), file);
  return { file, loaded };
}

/**
 * Shows a read in the Styles tab and replaces the palette group Styles. A chosen card and a
 * pending step are kept when the card is still there; an asked key wins.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param read - The file and its load.
 * @param key - The card to select; default the card already chosen, else none.
 */
function showStyles(ctx: FlowCtx, env: FlowEnvironment, read: StylesRead, key?: string): void {
  const { inspector } = ctx.state;
  const { file, loaded } = read;
  if (loaded === undefined || isStyleEditError(loaded)) {
    inspector.styles = emptyStyles(file, loaded ?? { error: "no-file" });
    env.setStyleItems([]);
    notify(ctx.state);
    return;
  }
  const blocks = textBlocks(loaded.file.blocks);
  const keys = keysOf(blocks);
  const chosen = [key, inspector.styles?.key].find(
    candidate => candidate !== undefined && keys.includes(candidate)
  );
  inspector.styles = {
    file,
    text: loaded.text,
    version: loaded.version,
    blocks,
    key: chosen,
    pending: inspector.styles?.pending,
    writing: false,
    result: undefined,
    error: undefined
  };
  env.setStyleItems(keys);
  notify(ctx.state);
}

/**
 * Loads the index's text-styles file into the Styles tab and replaces the palette group Styles
 * (remembered as the file the group was read from). No card is
 * chosen unless asked for (no preselect); a load that lands after the user chose a card or pressed
 * a stepper keeps that card and the pending step.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param key - The card to select; default the card already chosen, else none.
 * @returns Resolves when loaded.
 */
export async function openStyles(ctx: FlowCtx, env: FlowEnvironment, key?: string): Promise<void> {
  ctx.state.inspector.keysFile = textStylesFile(env.project());
  showStyles(ctx, env, await readStyles(env), key);
}

/**
 * True when a read shows what the tab already shows: the same file at the same version (the
 * editor's own write), or still no file (the reason line reads the project state when drawn).
 *
 * @param styles - The Styles tab slice.
 * @param read - The new read.
 * @returns Whether the tab stays as it is.
 */
function isSameRead(styles: StylesState, read: StylesRead): boolean {
  const { file, loaded } = read;
  if (file !== styles.file) return false;
  if (loaded === undefined) return true;

  return !isStyleEditError(loaded) && loaded.version === styles.version;
}

/**
 * Reads the Styles tab again after a project change (link:project, D-46). The tab and its result
 * line stay when the index names the same file at the same version (the batch of the editor's own
 * write), and when an edit of its own started meanwhile; a newer open wins.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns Resolves when the tab shows the new read or stays.
 */
export async function followStyles(ctx: FlowCtx, env: FlowEnvironment): Promise<void> {
  const { inspector } = ctx.state;
  const shown = inspector.styles;
  if (shown === undefined || isWriting(shown)) return;

  const read = await readStyles(env);
  const styles = inspector.styles;
  if (styles !== shown || isWriting(styles) || isSameRead(styles, read)) return;

  inspector.keysFile = read.file;
  showStyles(ctx, env, read);
}

/**
 * The result line after a style write, from the reload that followed it: a hot swap (U10)
 * reloaded nothing, so there is nothing to restore; a state that was not restored names why.
 *
 * @param where - The written place, `file:line`.
 * @param reload - The reload's result.
 * @returns The result line.
 * @example
 * ```ts
 * reloadResultLine("features/ui/styles.ts:74", { restored: false, reason: "hot_swap" }).text; // "✓ Written to features/ui/styles.ts:74 · game updated"
 * reloadResultLine("features/ui/styles.ts:74", { restored: false, reason: "timeout" }).ok; // false
 * ```
 */
function reloadResultLine(where: string, reload: ReloadResult): NonNullable<StylesState["result"]> {
  if (reload.reason === "hot_swap") {
    return { ok: true, text: `✓ Written to ${where} · game updated` };
  }
  if (reload.restored) {
    return { ok: true, text: `✓ Written to ${where} · game reloaded · state restored` };
  }
  const reason = reload.reason ?? "unknown";
  return {
    ok: false,
    text: `! Written to ${where} · game reloaded, state not restored (${reason})`
  };
}

/**
 * Writes the pending stepper burst with the card's version, then reloads the game.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns Resolves when the result line is set.
 */
export async function writeStyle(ctx: FlowCtx, env: FlowEnvironment): Promise<void> {
  const styles = ctx.state.inspector.styles;
  const pending = styles?.pending;
  const file = styles?.file;
  if (styles === undefined || pending === undefined || file === undefined) return;
  styles.pending = undefined;
  const target = {
    ref: { kind: "text" as const, key: pending.key },
    path: pending.path,
    raw: pending.raw
  };

  // One version-checked write of the literal; the moment before it is where the reload starts
  // to look for the game's hot swap.
  const savedAt = Date.now();
  let written: Awaited<ReturnType<typeof writeNumber>>;
  styles.writing = true;
  try {
    written = await writeNumber(
      env.files(),
      file,
      { text: styles.text, version: styles.version },
      target,
      pending.next
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    ctx.log.warn("flowView: style not written", { file, message });
    styles.result = { ok: false, text: `! ${bareMessage(message)}` };
    notify(ctx.state);
    return;
  } finally {
    styles.writing = false;
  }

  // A refusal of the shared style edit shows on the card; nothing was written.
  if (isStyleEditError(written)) {
    styles.error = written;
    styles.result = { ok: false, text: styleErrorText(written, file, env.project()) };
    notify(ctx.state);
    return;
  }

  // Written: the cards follow the new text at once.
  const parsed = parseStyleFile(written.text);
  styles.text = written.text;
  styles.version = written.version;
  if (!isStyleEditError(parsed)) styles.blocks = textBlocks(parsed.blocks);
  env.toast("Saved", file);
  notify(ctx.state);

  // The game reloads (or swaps the module in place) and the result line says which.
  const reload = await env.reload(savedAt);
  styles.result = reloadResultLine(`${file}:${written.line}`, reload);
  notify(ctx.state);
}

/**
 * One stepper press: the next value from the shared rule (clamped), debounced into one write per
 * burst; a field without a rule is read-only.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param path - The field path ("size", "shadow.dy").
 * @param direction - 1 up, -1 down.
 * @param big - Shift held.
 */
export function stepStyle(
  ctx: FlowCtx,
  env: FlowEnvironment,
  path: string,
  direction: 1 | -1,
  big: boolean
): void {
  const styles = ctx.state.inspector.styles;
  const key = styles?.key;
  if (styles === undefined || key === undefined) return;
  const block = styles.blocks.find(entry => entry.ref.kind === "text" && entry.ref.key === key);
  const field = block?.fields.find(entry => entry.path === path);
  if (field?.kind !== "number") return;
  const rule = fieldRule({ kind: "text", key }, path);
  if (rule === undefined) {
    styles.error = { error: "read-only", path };
    styles.result = {
      ok: false,
      text: styleErrorText(styles.error, styles.file, env.project())
    };
    notify(ctx.state);
    return;
  }

  const previous = styles.pending;
  const same = previous?.key === key && previous.path === path;
  if (previous?.timer !== undefined) {
    clearTimeout(previous.timer);
    ctx.state.view.timers.delete(previous.timer);
  }
  if (previous !== undefined && !same) writeStyle(ctx, env).catch(() => {});

  const next = stepValue(rule, same ? previous.next : field.value, direction, big);
  const timer = setTimeout(() => {
    ctx.state.view.timers.delete(timer);
    writeStyle(ctx, env).catch(() => {});
  }, ctx.config.styleSaveDelayMs);
  ctx.state.view.timers.add(timer);
  styles.pending = { key, path, raw: field.raw, next, timer };
  styles.error = undefined;
  styles.result = { ok: true, text: "Writing…" };
  notify(ctx.state);
}
