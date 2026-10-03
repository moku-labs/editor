/**
 * @file workspace plugin — the keyboard map (design §4): combo parsing and matching (`mod` = ⌘ on
 * Apple platforms, Ctrl elsewhere; a digit with shift matches `event.code`), the bind registry
 * with its duplicate check, and the dispatcher behind the one window `keydown` listener.
 */
import { ERROR_PREFIX } from "../../registry/protocol";
import type { KeyBinding, KeyBindingEntry, ParsedCombo, WorkspaceCtx } from "../types";
import { unwind } from "./escape";

/**
 * A letter or a digit (keys that are not symbols).
 */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Apple platforms, read from `navigator.platform` (or the user agent when it is empty).
 */
const APPLE = /mac|iphone|ipad|ipod/i;

/**
 * Display names of the named keys in tooltips.
 */
const KEY_NAMES: Readonly<Record<string, string>> = {
  escape: "Esc",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↵"
};

/**
 * Elements in which single keys type text.
 */
const EDITABLE = "input, textarea, select, [contenteditable]:not([contenteditable='false'])";

/**
 * Parses a combo like "shift+mod+c", "+" or "mod++" (lower-cased).
 *
 * @param combo - Tokens `mod`, `shift`, `alt` and one key name, joined with "+".
 * @returns The parsed combo.
 * @throws {Error} `[moku-editor] Key "<combo>" has an unknown modifier …` for another token.
 * @example
 * ```ts
 * parseCombo("shift+mod+c"); // { mod: true, shift: true, alt: false, key: "c" }
 * ```
 */
export function parseCombo(combo: string): ParsedCombo {
  const text = combo.toLowerCase();
  const plus = text === "+" || text.endsWith("++");
  const head = plus ? text.slice(0, -2) : text.slice(0, Math.max(0, text.lastIndexOf("+")));
  const key = plus ? "+" : text.slice(text.lastIndexOf("+") + 1);
  const tokens = head === "" ? [] : head.split("+");

  const unknown = tokens.find(token => token !== "mod" && token !== "shift" && token !== "alt");
  if (unknown !== undefined) {
    throw new Error(
      `${ERROR_PREFIX}Key "${combo}" has an unknown modifier "${unknown}".\n  Use mod, shift or alt.`
    );
  }
  return {
    mod: tokens.includes("mod"),
    shift: tokens.includes("shift"),
    alt: tokens.includes("alt"),
    key
  };
}

/**
 * True for a one-character key that is neither a letter nor a digit (".", "+", "-").
 *
 * @param key - A parsed key.
 * @returns Whether it is a symbol.
 * @example
 * ```ts
 * isSymbol("+"); // true
 * ```
 */
function isSymbol(key: string): boolean {
  return key.length === 1 && !WORD_CHARACTER.test(key);
}

/**
 * Whether the key part of a combo matches the event (modifiers already checked).
 *
 * @param combo - A parsed combo.
 * @param event - The keydown.
 * @returns Whether the key matches.
 * @example
 * ```ts
 * keyMatches(parseCombo("shift+1"), event); // true for "!" with code Digit1
 * ```
 */
function keyMatches(combo: ParsedCombo, event: KeyboardEvent): boolean {
  const { key } = combo;
  const pressed = event.key.toLowerCase();

  if (/^\d$/.test(key)) {
    const code = event.code === `Digit${key}`;
    return combo.shift ? event.shiftKey && code : !event.shiftKey && (pressed === key || code);
  }
  if (combo.shift !== event.shiftKey && !(isSymbol(key) && !combo.shift)) return false;
  if (pressed === key) return true;
  // macOS types a symbol for Alt+letter: match the physical key then.
  return combo.alt && /^[a-z]$/.test(key) && event.code === `Key${key.toUpperCase()}`;
}

/**
 * Whether a parsed combo matches a keydown.
 *
 * @param combo - The parsed combo.
 * @param event - The keydown.
 * @param apple - True on Apple platforms (`mod` = ⌘), false elsewhere (`mod` = Ctrl).
 * @returns Whether it matches.
 * @example
 * ```ts
 * matchCombo(parseCombo("mod+k"), event, isApplePlatform(navigator));
 * ```
 */
export function matchCombo(combo: ParsedCombo, event: KeyboardEvent, apple: boolean): boolean {
  const moduleDown = apple ? event.metaKey : event.ctrlKey;
  if (combo.mod !== moduleDown) return false;
  if (!combo.mod && (event.metaKey || event.ctrlKey)) return false;
  if (combo.alt !== event.altKey) return false;
  return keyMatches(combo, event);
}

/**
 * True on Apple platforms.
 *
 * @param nav - The navigator (or undefined outside a browser).
 * @param nav.platform - `navigator.platform`.
 * @param nav.userAgent - `navigator.userAgent`, used when the platform is empty.
 * @returns Whether `mod` means ⌘.
 * @example
 * ```ts
 * isApplePlatform(globalThis.navigator);
 * ```
 */
export function isApplePlatform(
  nav: { readonly platform?: string; readonly userAgent?: string } | undefined
): boolean {
  if (nav === undefined) return false;
  return APPLE.test(nav.platform || nav.userAgent || "");
}

/**
 * A combo for tooltips and palette items: "⇧⌘C" on Apple, "Ctrl+Shift+C" elsewhere.
 *
 * @param combo - The combo text.
 * @param apple - True on Apple platforms.
 * @returns The display text.
 * @example
 * ```ts
 * formatCombo("mod+k", true); // "⌘K"
 * ```
 */
export function formatCombo(combo: string, apple: boolean): string {
  const parsed = parseCombo(combo);
  const named = KEY_NAMES[parsed.key];
  const key = named ?? parsed.key.toUpperCase();
  if (apple) {
    return `${parsed.alt ? "⌥" : ""}${parsed.shift ? "⇧" : ""}${parsed.mod ? "⌘" : ""}${key}`;
  }
  const parts = [parsed.mod ? "Ctrl" : "", parsed.alt ? "Alt" : "", parsed.shift ? "Shift" : ""];
  return [...parts.filter(part => part !== ""), key].join("+");
}

/**
 * Two combos press the same keys.
 *
 * @param a - A combo.
 * @param b - Another combo.
 * @returns Whether they are equal.
 * @example
 * ```ts
 * sameCombo(parseCombo("N"), parseCombo("n")); // true
 * ```
 */
function sameCombo(a: ParsedCombo, b: ParsedCombo): boolean {
  return a.mod === b.mod && a.shift === b.shift && a.alt === b.alt && a.key === b.key;
}

/**
 * Registers a key binding. Two bindings of one scope may share a combo only when one of them has
 * a `when` condition.
 *
 * @param ctx - Domain context of workspace.
 * @param binding - The binding.
 * @returns Removes the binding.
 * @throws {Error} `[moku-editor] Key "<combo>" is already bound in <scope>.` for a clash.
 * @example
 * ```ts
 * const off = bindKey(ctx, { keys: "n", label: "New note", workspace: "flow", run: openNote });
 * ```
 */
export function bindKey(ctx: Pick<WorkspaceCtx, "state">, binding: KeyBinding): () => void {
  const texts = typeof binding.keys === "string" ? [binding.keys] : [...binding.keys];
  const combos = texts.map(text => parseCombo(text));
  const scope = binding.workspace ?? "global";
  const { bindings } = ctx.state.keys;

  if (binding.when === undefined) {
    for (const entry of bindings) {
      if ((entry.binding.workspace ?? "global") !== scope || entry.binding.when !== undefined) {
        continue;
      }
      const clash = texts.find((_text, index) =>
        entry.combos.some(combo => sameCombo(combo, combos[index] ?? combo))
      );
      if (clash !== undefined) {
        throw new Error(
          `${ERROR_PREFIX}Key "${clash}" is already bound in ${scope}.\n  Pick another key, or give both bindings a when condition.`
        );
      }
    }
  }

  const entry: KeyBindingEntry = { combos, binding };
  bindings.push(entry);
  return () => {
    const index = bindings.indexOf(entry);
    if (index !== -1) bindings.splice(index, 1);
  };
}

/**
 * True when the event target types text (an input, a textarea, a select, contenteditable).
 *
 * @param target - The event target.
 * @returns Whether single keys belong to the field.
 * @example
 * ```ts
 * isEditableTarget(event.target);
 * ```
 */
export function isEditableTarget(target: EventTarget | null): boolean {
  if (globalThis.Element === undefined || !(target instanceof Element)) return false;
  return target.closest(EDITABLE) !== null;
}

/**
 * The binding a keydown runs: workspace-scoped bindings of the active workspace first, then
 * global ones; the first whose combo matches, whose `when` passes and that may run in a field.
 *
 * @param ctx - Domain context of workspace.
 * @param event - The keydown.
 * @returns The entry, undefined when none applies.
 * @example
 * ```ts
 * findBinding(ctx, event)?.binding.run(event);
 * ```
 */
function findBinding(
  ctx: Pick<WorkspaceCtx, "state">,
  event: KeyboardEvent
): KeyBindingEntry | undefined {
  const { active, keys } = ctx.state;
  const apple = isApplePlatform(globalThis.navigator);
  const editable = isEditableTarget(event.target);
  const scoped = keys.bindings.filter(entry => entry.binding.workspace === active);
  const global = keys.bindings.filter(entry => entry.binding.workspace === undefined);

  return [...scoped, ...global].find(entry => {
    const combo = entry.combos.find(candidate => matchCombo(candidate, event, apple));
    if (combo === undefined) return false;
    if (editable && !combo.mod && entry.binding.inInputs !== true) return false;
    return entry.binding.when?.() ?? true;
  });
}

/**
 * Handles a keydown: Esc unwinds one layer; while the palette is open only the palette handles
 * keys; otherwise the first applicable binding runs and the event is `preventDefault`ed.
 *
 * @param ctx - Domain context of workspace.
 * @param event - The keydown (window, capture phase).
 * @returns True when the key was handled.
 * @example
 * ```ts
 * globalThis.addEventListener("keydown", event => dispatchKey(ctx, event), true);
 * ```
 */
export function dispatchKey(ctx: Pick<WorkspaceCtx, "state">, event: KeyboardEvent): boolean {
  if (event.key === "Escape" && unwind(ctx)) {
    event.preventDefault();
    return true;
  }
  if (ctx.state.palette.open) return false;

  const entry = findBinding(ctx, event);
  if (entry === undefined) return false;

  event.preventDefault();
  entry.binding.run(event);
  return true;
}
