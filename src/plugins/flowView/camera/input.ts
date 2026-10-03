/**
 * @file flowView camera module — the pure input interpreter of design §4: wheel and pinch to
 * camera ops, the click-vs-drag rule on release (M2), the camera keys and the text-field check.
 */
import type { CameraIntent, CameraOp, HitTarget } from "./types";

/**
 * A pointer that moved less than this many px between down and up made a click.
 */
export const DRAG_THRESHOLD = 3;

/**
 * Pixels per wheel line (deltaMode 1).
 */
const LINE_PX = 16;

/**
 * Zoom sensitivity of Ctrl/⌘ + wheel and pinch.
 */
const ZOOM_RATE = 0.01;

/**
 * The camera keys (design §4), bound through workspace.keys with `workspace: "flow"`.
 */
export const KEY_OPS: readonly {
  readonly keys: readonly string[];
  readonly label: string;
  readonly op: CameraOp;
}[] = [
  { keys: ["+", "="], label: "Zoom in", op: { kind: "zoomBy", factor: 1.25 } },
  { keys: ["-"], label: "Zoom out", op: { kind: "zoomBy", factor: 0.8 } },
  { keys: ["0"], label: "Zoom to 100 %", op: { kind: "zoomTo", z: 1 } },
  { keys: ["f", "shift+1"], label: "Fit all", op: { kind: "fit", target: "all" } },
  { keys: ["shift+2"], label: "Fit selection", op: { kind: "fit", target: "selection" } }
];

/**
 * Turns a wheel event into a pan or a zoom: Ctrl/⌘ (and trackpad pinch) zooms at the pointer,
 * Shift pans horizontally, anything else pans by (−deltaX, −deltaY). Lines count 16 px, pages the
 * viewport height.
 *
 * @param event - The wheel fields.
 * @param event.deltaX - Horizontal delta.
 * @param event.deltaY - Vertical delta.
 * @param event.deltaMode - 0 px, 1 lines, 2 pages.
 * @param event.shiftKey - Shift held.
 * @param event.ctrlKey - Ctrl held (browsers set it on pinch).
 * @param event.metaKey - ⌘ held.
 * @param pointer - The pointer in canvas px.
 * @param pointer.x - Canvas x.
 * @param pointer.y - Canvas y.
 * @param viewHeight - The viewport height in px.
 * @returns The camera op.
 * @example
 * ```ts
 * wheelOp({ deltaX: 10, deltaY: 20, deltaMode: 0, shiftKey: false, ctrlKey: false, metaKey: false }, { x: 0, y: 0 }, 800);
 * // { kind: "pan", dx: -10, dy: -20 }
 * ```
 */
export function wheelOp(
  event: {
    readonly deltaX: number;
    readonly deltaY: number;
    readonly deltaMode: number;
    readonly shiftKey: boolean;
    readonly ctrlKey: boolean;
    readonly metaKey: boolean;
  },
  pointer: { readonly x: number; readonly y: number },
  viewHeight: number
): CameraOp {
  let scale = 1;
  if (event.deltaMode === 1) scale = LINE_PX;
  if (event.deltaMode === 2) scale = viewHeight;
  const dx = event.deltaX * scale;
  const dy = event.deltaY * scale;

  if (event.ctrlKey || event.metaKey) {
    return { kind: "zoom", px: pointer.x, py: pointer.y, factor: Math.exp(-dy * ZOOM_RATE) };
  }
  if (event.shiftKey) return { kind: "pan", dx: -(dx + dy) || 0, dy: 0 };
  return { kind: "pan", dx: -dx || 0, dy: -dy || 0 };
}

/**
 * What a pointer release means: under 3 px it is a click — a card, a note or the hub head selects
 * its item; empty canvas, a frame background or a lane band clears the selection (M2). A longer
 * move was a pan or a drag and means nothing more.
 *
 * @param moved - Distance between down and up in px.
 * @param target - What the pointer went down on.
 * @param key - The item key under the pointer, if any.
 * @returns The intent, or undefined after a drag.
 * @example
 * ```ts
 * releaseIntent(1, "frame", "main/board"); // { kind: "clear" }
 * ```
 */
export function releaseIntent(
  moved: number,
  target: HitTarget,
  key: string | undefined
): CameraIntent | undefined {
  if (moved >= DRAG_THRESHOLD) return undefined;

  const selects = target === "card" || target === "note" || target === "hub-head";
  return selects && key !== undefined ? { kind: "select", key } : { kind: "clear" };
}

/**
 * True for an element that takes text: input, textarea, select or contenteditable.
 *
 * @param target - An event target.
 * @returns Whether keys typed there belong to the field.
 * @example
 * ```ts
 * isTextField(document.createElement("input")); // true
 * ```
 */
export function isTextField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable ||
    target.getAttribute("contenteditable") === "true"
  );
}
