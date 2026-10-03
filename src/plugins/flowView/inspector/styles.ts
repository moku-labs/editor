/**
 * @file flowView inspector module — the Styles tab controller over the shared style edit
 * (panels/shared/style-edit, R4, R8): load the text-style cards, stepper bursts debounced into one
 * version-checked write of one numeric literal, then the D-07 reload. flowView owns only the
 * texts of the shared error codes.
 */
import type { StyleBlock, StyleEditError } from "../../panels/shared/style-edit";
import {
  fieldRule,
  isStyleEditError,
  loadStyleFile,
  parseStyleFile,
  stepValue,
  writeNumber
} from "../../panels/shared/style-edit";
import type { Json } from "../../registry/protocol";
import { bareMessage } from "../../registry/protocol";
import { notify } from "../state";
import type { FlowCtx, FlowEnvironment } from "../types";

/**
 * flowView's text for a refused style edit (one row per shared code).
 *
 * @param error - The shared error.
 * @param file - The styles file.
 * @returns The text shown on the card.
 * @example
 * ```ts
 * styleErrorText({ error: "read-only", path: "lineHeight" }, "features/ui/styles.ts"); // "lineHeight has no edit rule · edit it in Files"
 * ```
 */
export function styleErrorText(error: StyleEditError, file: string): string {
  const path = error.path ?? "the field";
  const key = error.key ?? "the style";
  switch (error.error) {
    case "no-file": {
      return `No text styles at ${file} · set flowView.stylesFile`;
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
 * textBlocks(file.blocks).length; // 18
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
 * keysOf(blocks); // ["ui.title", "ui.button", …]
 * ```
 */
export function keysOf(blocks: readonly StyleBlock[]): string[] {
  return blocks.flatMap(block => (block.ref.kind === "text" ? [block.ref.key] : []));
}

/**
 * Loads the styles file into the Styles tab and replaces the palette group Styles.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @param key - The card to select; default the first key.
 * @returns Resolves when loaded.
 * @example
 * ```ts
 * await openStyles(ctx, env, "ui.number");
 * ```
 */
export async function openStyles(ctx: FlowCtx, env: FlowEnvironment, key?: string): Promise<void> {
  const { inspector } = ctx.state;
  const file = ctx.config.stylesFile;
  const loaded = await loadStyleFile(env.files(), file);
  if (isStyleEditError(loaded)) {
    inspector.styles = {
      text: "",
      version: "",
      blocks: [],
      key: undefined,
      pending: undefined,
      result: undefined,
      error: loaded
    };
    env.setStyleItems([]);
    notify(ctx.state);
    return;
  }
  const blocks = textBlocks(loaded.file.blocks);
  const keys = keysOf(blocks);
  inspector.styles = {
    text: loaded.text,
    version: loaded.version,
    blocks,
    key: key !== undefined && keys.includes(key) ? key : keys[0],
    pending: undefined,
    result: undefined,
    error: undefined
  };
  env.setStyleItems(keys);
  notify(ctx.state);
}

/**
 * Writes the pending stepper burst with the card's version, then reloads the game.
 *
 * @param ctx - Domain context of flowView.
 * @param env - Services and actions.
 * @returns Resolves when the result line is set.
 * @example
 * ```ts
 * await writeStyle(ctx, env);
 * ```
 */
export async function writeStyle(ctx: FlowCtx, env: FlowEnvironment): Promise<void> {
  const styles = ctx.state.inspector.styles;
  const pending = styles?.pending;
  if (styles === undefined || pending === undefined) return;
  styles.pending = undefined;
  const file = ctx.config.stylesFile;
  const target = {
    ref: { kind: "text" as const, key: pending.key },
    path: pending.path,
    raw: pending.raw
  };

  let written: Awaited<ReturnType<typeof writeNumber>>;
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
  }
  if (isStyleEditError(written)) {
    styles.error = written;
    styles.result = { ok: false, text: styleErrorText(written, file) };
    notify(ctx.state);
    return;
  }

  const parsed = parseStyleFile(written.text);
  styles.text = written.text;
  styles.version = written.version;
  if (!isStyleEditError(parsed)) styles.blocks = textBlocks(parsed.blocks);
  env.toast("Saved", file);
  notify(ctx.state);

  const reload = await env.reload();
  styles.result = reload.restored
    ? { ok: true, text: `✓ Written to ${file}:${written.line} · game reloaded · state restored` }
    : {
        ok: false,
        text: `! Written to ${file}:${written.line} · game reloaded, state not restored (${reload.reason ?? "unknown"})`
      };
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
 * @example
 * ```ts
 * stepStyle(ctx, env, "size", 1, false);
 * ```
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
    styles.result = { ok: false, text: styleErrorText(styles.error, ctx.config.stylesFile) };
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

/**
 * The UI node names whose text style is a key, from one read of game.ui (empty until F-G1).
 *
 * @param ui - The game.ui value.
 * @param key - The text-style key.
 * @returns Node names.
 * @example
 * ```ts
 * usedByOf({ key: "coins", local: { textStyle: "ui.number" } }, "ui.number"); // ["coins"]
 * ```
 */
export function usedByOf(ui: Json, key: string): string[] {
  const names: string[] = [];
  /**
   * Collects the matching nodes of one value and its children.
   *
   * @param value - A part of game.ui.
   * @example
   * ```ts
   * visit(ui);
   * ```
   */
  function visit(value: Json): void {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value !== "object" || value === null) return;
    const local = value.local;
    if (
      typeof local === "object" &&
      local !== null &&
      !Array.isArray(local) &&
      local.textStyle === key
    ) {
      const name = value.key ?? value.name ?? value.id;
      if (typeof name === "string" && !names.includes(name)) names.push(name);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(ui);
  return names;
}
