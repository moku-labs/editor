// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { addEscapeLayer } from "../../keys/escape";
import {
  bindKey,
  dispatchKey,
  formatCombo,
  isApplePlatform,
  matchCombo,
  parseCombo
} from "../../keys/keymap";
import { createCtx, keyEvent } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Combo parsing and matching, the bind registry and the dispatcher
// ─────────────────────────────────────────────────────────────────────────────

describe("parseCombo", () => {
  it("reads modifiers and the key in any order, lower-cased", () => {
    expect(parseCombo("shift+Mod+C")).toEqual({ mod: true, shift: true, alt: false, key: "c" });
    expect(parseCombo("alt+arrowleft")).toEqual({
      mod: false,
      shift: false,
      alt: true,
      key: "arrowleft"
    });
  });

  it("reads the plus key alone and after modifiers", () => {
    expect(parseCombo("+")).toEqual({ mod: false, shift: false, alt: false, key: "+" });
    expect(parseCombo("mod++")).toEqual({ mod: true, shift: false, alt: false, key: "+" });
  });
});

describe("matchCombo", () => {
  it("mod is ⌘ on Apple platforms and Ctrl elsewhere", () => {
    const combo = parseCombo("mod+k");
    expect(matchCombo(combo, keyEvent("k", { metaKey: true }), true)).toBe(true);
    expect(matchCombo(combo, keyEvent("k", { ctrlKey: true }), true)).toBe(false);
    expect(matchCombo(combo, keyEvent("k", { ctrlKey: true }), false)).toBe(true);
    expect(matchCombo(combo, keyEvent("k", { metaKey: true }), false)).toBe(false);
    expect(matchCombo(combo, keyEvent("k"), true)).toBe(false);
  });

  it("a bare key does not match with a modifier held", () => {
    expect(matchCombo(parseCombo("p"), keyEvent("p", { metaKey: true }), true)).toBe(false);
    expect(matchCombo(parseCombo("p"), keyEvent("P", { shiftKey: true }), true)).toBe(false);
    expect(matchCombo(parseCombo("p"), keyEvent("P"), true)).toBe(true);
  });

  it("a digit with shift matches event.code, since event.key is the symbol", () => {
    const combo = parseCombo("shift+1");
    expect(matchCombo(combo, keyEvent("!", { shiftKey: true, code: "Digit1" }), true)).toBe(true);
    expect(matchCombo(combo, keyEvent("1", { code: "Digit1" }), true)).toBe(false);
  });

  it("punctuation typed with shift still matches its bare binding", () => {
    expect(matchCombo(parseCombo("+"), keyEvent("+", { shiftKey: true }), true)).toBe(true);
    expect(matchCombo(parseCombo("."), keyEvent("."), false)).toBe(true);
  });

  it("an alt letter matches by code (macOS types a symbol)", () => {
    expect(
      matchCombo(parseCombo("alt+n"), keyEvent("˜", { altKey: true, code: "KeyN" }), true)
    ).toBe(true);
  });
});

describe("isApplePlatform and formatCombo", () => {
  it("reads the platform from navigator", () => {
    expect(isApplePlatform({ platform: "MacIntel", userAgent: "" })).toBe(true);
    expect(isApplePlatform({ platform: "", userAgent: "iPhone OS" })).toBe(true);
    expect(isApplePlatform({ platform: "Win32", userAgent: "Windows" })).toBe(false);
    expect(isApplePlatform(undefined)).toBe(false);
  });

  it("formats a combo for tooltips", () => {
    expect(formatCombo("mod+k", true)).toBe("⌘K");
    expect(formatCombo("mod+k", false)).toBe("Ctrl+K");
    expect(formatCombo("shift+mod+c", true)).toBe("⇧⌘C");
    expect(formatCombo(".", true)).toBe(".");
    expect(formatCombo("escape", true)).toBe("Esc");
    expect(formatCombo("alt+arrowleft", false)).toBe("Alt+←");
  });
});

describe("bindKey", () => {
  it("throws the exact message for a duplicate combo in one scope without when", () => {
    const ctx = createCtx();
    bindKey(ctx, { keys: "n", label: "Note", run: vi.fn(), workspace: "flow" });

    expect(() =>
      bindKey(ctx, { keys: ["x", "n"], label: "Other", run: vi.fn(), workspace: "flow" })
    ).toThrow(
      '[moku-editor] Key "n" is already bound in flow.\n  Pick another key, or give both bindings a when condition.'
    );
    expect(() => bindKey(ctx, { keys: "N", label: "Global", run: vi.fn() })).not.toThrow();
    expect(() => bindKey(ctx, { keys: "n", label: "Again", run: vi.fn() })).toThrow(
      '[moku-editor] Key "n" is already bound in global.\n  Pick another key, or give both bindings a when condition.'
    );
  });

  it("allows a shared combo when one binding has a when condition", () => {
    const ctx = createCtx();
    bindKey(ctx, { keys: "b", label: "Bug", run: vi.fn(), workspace: "game" });
    expect(() =>
      bindKey(ctx, { keys: "b", label: "Sheet", run: vi.fn(), workspace: "game", when: () => true })
    ).not.toThrow();
  });

  it("returns a remover that frees the combo", () => {
    const ctx = createCtx();
    const remove = bindKey(ctx, { keys: "h", label: "History", run: vi.fn() });
    remove();
    remove();
    expect(ctx.state.keys.bindings).toHaveLength(0);
    expect(() => bindKey(ctx, { keys: "h", label: "Again", run: vi.fn() })).not.toThrow();
  });
});

describe("dispatchKey", () => {
  it("runs a global binding and prevents the default", () => {
    const ctx = createCtx();
    const run = vi.fn();
    bindKey(ctx, { keys: "p", label: "Pause", run });
    const event = keyEvent("p");

    expect(dispatchKey(ctx, event)).toBe(true);
    expect(run).toHaveBeenCalledWith(event);
    expect(event.defaultPrevented).toBe(true);
  });

  it("prefers a binding of the active workspace over a global one", () => {
    const ctx = createCtx();
    const global = vi.fn();
    const flow = vi.fn();
    const game = vi.fn();
    bindKey(ctx, { keys: "f", label: "Global", run: global, when: () => true });
    bindKey(ctx, { keys: "f", label: "Game", run: game, workspace: "game" });
    bindKey(ctx, { keys: "f", label: "Flow", run: flow, workspace: "flow" });

    dispatchKey(ctx, keyEvent("f"));
    expect(flow).toHaveBeenCalledTimes(1);
    expect(global).not.toHaveBeenCalled();
    expect(game).not.toHaveBeenCalled();

    ctx.state.active = "render";
    dispatchKey(ctx, keyEvent("f"));
    expect(global).toHaveBeenCalledTimes(1);
  });

  it("skips a binding whose when fails and runs the next one", () => {
    const ctx = createCtx();
    const first = vi.fn();
    const second = vi.fn();
    bindKey(ctx, { keys: "s", label: "First", run: first, when: () => false });
    bindKey(ctx, { keys: "s", label: "Second", run: second });

    dispatchKey(ctx, keyEvent("s"));
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("ignores single keys in inputs unless the binding sets inInputs", () => {
    const ctx = createCtx();
    const single = vi.fn();
    const palette = vi.fn();
    const editable = vi.fn();
    bindKey(ctx, { keys: "g", label: "Preview", run: single });
    bindKey(ctx, { keys: "mod+k", label: "Palette", run: palette, inInputs: true });
    bindKey(ctx, { keys: "e", label: "Edit", run: editable, inInputs: true });
    const input = document.createElement("input");
    document.body.append(input);
    const area = document.createElement("div");
    area.setAttribute("contenteditable", "true");
    document.body.append(area);

    expect(dispatchKey(ctx, keyEventOn(input, "g"))).toBe(false);
    expect(dispatchKey(ctx, keyEventOn(area, "g"))).toBe(false);
    expect(single).not.toHaveBeenCalled();
    expect(dispatchKey(ctx, keyEventOn(input, "k", { metaKey: true, ctrlKey: true }))).toBe(true);
    expect(palette).toHaveBeenCalledTimes(1);
    expect(dispatchKey(ctx, keyEventOn(input, "e"))).toBe(true);
    expect(editable).toHaveBeenCalledTimes(1);
    input.remove();
    area.remove();
  });

  it("a mod combo without inInputs still runs from an input", () => {
    const ctx = createCtx();
    const save = vi.fn();
    bindKey(ctx, { keys: "mod+s", label: "Save", run: save });
    const input = document.createElement("textarea");
    document.body.append(input);

    expect(dispatchKey(ctx, keyEventOn(input, "s", { metaKey: true, ctrlKey: true }))).toBe(true);
    expect(save).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("while the palette is open only the palette handles keys", () => {
    const ctx = createCtx();
    const run = vi.fn();
    bindKey(ctx, { keys: "p", label: "Pause", run });
    ctx.state.palette.open = true;

    expect(dispatchKey(ctx, keyEvent("p"))).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });

  it("Esc unwinds one layer and prevents the default only when something closed", () => {
    const ctx = createCtx();
    const close = vi.fn(() => true);
    const nothing = keyEvent("Escape");
    expect(dispatchKey(ctx, nothing)).toBe(false);
    expect(nothing.defaultPrevented).toBe(false);

    addEscapeLayer(ctx, "registry", close);
    const press = keyEvent("Escape");
    expect(dispatchKey(ctx, press)).toBe(true);
    expect(press.defaultPrevented).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("Esc reaches the palette layer while the palette is open", () => {
    const ctx = createCtx();
    ctx.state.palette.open = true;
    addEscapeLayer(ctx, "palette", () => {
      ctx.state.palette.open = false;
      return true;
    });

    expect(dispatchKey(ctx, keyEvent("Escape"))).toBe(true);
    expect(ctx.state.palette.open).toBe(false);
  });

  it("returns false for a key nobody bound", () => {
    expect(dispatchKey(createCtx(), keyEvent("z"))).toBe(false);
  });
});

/**
 * A keydown whose target is the given element.
 *
 * @param target - The element the key is pressed in.
 * @param key - `event.key`.
 * @param init - Modifiers.
 * @returns The dispatched event.
 */
function keyEventOn(target: Element, key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  const event = keyEvent(key, init);
  Object.defineProperty(event, "target", { value: target });
  return event;
}
