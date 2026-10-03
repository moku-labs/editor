import type { ComponentChild } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { buildScene, type SceneSnapshot } from "../../panels/shared/scene";
import { flush, sceneCapture } from "./helpers";

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
 * The board scene of merge-game, calibrated (identity).
 *
 * @returns The snapshot.
 */
export function boardScene(): SceneSnapshot {
  const capture = sceneCapture("scene-board.txt");
  const scene = buildScene({ ...capture, frame: 1841, calibration: { scale: 1, x: 0, y: 0 } });
  if ("error" in scene) throw new Error("fixture");
  return scene;
}
