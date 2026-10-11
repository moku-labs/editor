import type { ComponentChild } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { buildScene, type SceneSnapshot } from "../../panels/shared/scene";
import type { Json } from "../../registry/protocol";
import { flush, type SceneCapture, sceneCapture } from "./helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Component test helpers (happy-dom): mount into a fresh root, query, click,
// let effects and promises settle inside act().
// ─────────────────────────────────────────────────────────────────────────────

/** A mounted tree. */
export type Mounted = { readonly root: HTMLElement; unmount(): void };

/**
 * Renders a vnode into a fresh element in the body.
 *
 * @param vnode - What to render.
 * @returns The root and an unmount function.
 */
export function mount(vnode: ComponentChild): Mounted {
  const root = document.createElement("div");
  document.body.append(root);
  act(() => {
    render(vnode, root);
  });
  return {
    root,
    unmount() {
      act(() => {
        render(undefined, root);
      });
      root.remove();
    }
  };
}

/**
 * The first element matching a selector, or a failure.
 *
 * @param root - Where to look.
 * @param selector - CSS selector.
 * @returns The element.
 */
export function find<T extends Element = HTMLElement>(root: ParentNode, selector: string): T {
  const found = root.querySelector<T>(selector);
  if (found === null) throw new Error(`nothing matches ${selector}`);
  return found;
}

/**
 * Every element matching a selector.
 *
 * @param root - Where to look.
 * @param selector - CSS selector.
 * @returns The elements.
 */
export function findAll<T extends Element = HTMLElement>(root: ParentNode, selector: string): T[] {
  return [...root.querySelectorAll<T>(selector)];
}

/**
 * The button with a text.
 *
 * @param root - Where to look.
 * @param text - Its trimmed text content.
 * @returns The button.
 */
export function button(root: ParentNode, text: string): HTMLButtonElement {
  const found = findAll<HTMLButtonElement>(root, "button").find(
    element => element.textContent?.trim() === text
  );
  if (found === undefined) throw new Error(`no button ${text}`);
  return found;
}

/**
 * Clicks inside act().
 *
 * @param element - The element.
 */
export function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

/**
 * Dispatches an event inside act().
 *
 * @param element - The target.
 * @param event - The event.
 */
export function fire(element: Element, event: Event): void {
  act(() => {
    element.dispatchEvent(event);
  });
}

/**
 * Types a text into a field: the value, then the `input` event a keystroke fires.
 *
 * @param input - The field.
 * @param text - The whole text the field holds after the keystroke.
 */
export function typeInto(input: HTMLInputElement, text: string): void {
  act(() => {
    input.value = text;
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/**
 * Presses a key in an element (`keydown`).
 *
 * @param element - The target.
 * @param key - The key ("Enter", "Escape").
 */
export function pressKey(element: Element, key: string): void {
  fire(element, new KeyboardEvent("keydown", { key, bubbles: true }));
}

/**
 * Takes the focus from a field the way a browser does: `blur`, then `focusout`. Preact listens
 * to the first for `onBlur`, `preact/compat` to the second.
 *
 * @param element - The field.
 */
export function blurField(element: Element): void {
  act(() => {
    element.dispatchEvent(new FocusEvent("blur"));
    element.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
  });
}

/**
 * Lets promises and effects settle inside act().
 */
export async function settle(): Promise<void> {
  await act(async () => {
    await flush();
  });
  await act(async () => {
    await flush();
  });
}

/**
 * The scene of a capture, calibrated (identity).
 *
 * @param capture - The three scene sources.
 * @param frame - The frame of the snapshot.
 * @returns The snapshot.
 */
export function sceneOf(capture: SceneCapture, frame = 1841): SceneSnapshot {
  const scene = buildScene({ ...capture, frame, calibration: { scale: 1, x: 0, y: 0 } });
  if ("error" in scene) throw new Error("fixture");
  return scene;
}

/**
 * The board scene of merge-game, calibrated (identity).
 *
 * @returns The snapshot.
 */
export function boardScene(): SceneSnapshot {
  return sceneOf(sceneCapture("scene-board.txt"));
}

/** A raw node of a `game.ui` value. */
export type RawNode = { [key: string]: Json };

/**
 * The raw ui node with a key inside a `game.ui` value.
 *
 * @param ui - The value, or a node of it.
 * @param key - The ui key.
 * @returns The node, undefined when no node has the key.
 */
function rawNode(ui: Json, key: string): RawNode | undefined {
  if (typeof ui !== "object" || ui === null || Array.isArray(ui)) return undefined;
  if (ui.key === key) return ui;
  const children = Array.isArray(ui.children) ? ui.children : [];
  for (const child of children) {
    const found = rawNode(child, key);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The board capture with one raw ui node changed: the game after an agent wrote new style values
 * (or a node of another shape).
 *
 * @param key - The ui key of the node.
 * @param change - Changes the node in place.
 * @returns A fresh capture.
 */
export function boardCaptureWith(key: string, change: (node: RawNode) => void): SceneCapture {
  const capture = structuredClone(sceneCapture("scene-board.txt"));
  const node = rawNode(capture.ui, key);
  if (node === undefined) throw new Error(`fixture: no ui node ${key}`);
  change(node);
  return capture;
}

/**
 * The board capture with some style values of one node replaced.
 *
 * @param key - The ui key of the node.
 * @param style - The style entries to set.
 * @returns A fresh capture.
 */
export function boardCaptureStyled(
  key: string,
  style: { readonly [name: string]: Json }
): SceneCapture {
  return boardCaptureWith(key, node => {
    const before = node.style;
    const kept =
      typeof before === "object" && before !== null && !Array.isArray(before) ? before : {};
    node.style = { ...kept, ...style };
  });
}
