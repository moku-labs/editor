/**
 * @file workspace plugin — the safe insets of the emulated device on the game page (E-I1). While a
 * preset with safe insets is shown, `:root` of the game page carries `--moku-device-safe-top`,
 * `-right`, `-bottom` and `-left` in CSS px of the emulated screen, for its orientation and fold;
 * a preset without insets (Android, tablet, desktop) carries none. After each change the page
 * gets the window event `moku-native:insets`, so the engine lays the game out again. A game page
 * the tools page cannot reach (another origin) is left alone.
 */
import type { DeviceSize, WorkspaceState } from "../types";

/**
 * The window event the engine re-reads its safe insets on (the native shell sends it too).
 */
const INSETS_EVENT = "moku-native:insets";

/**
 * The four sides, in the order of the CSS properties.
 */
const SIDES = ["top", "right", "bottom", "left"] as const;

/**
 * The safe insets of a screen in CSS px.
 */
type SafeInsets = DeviceSize["safe"];

/**
 * A page with no insets: what a new page shows before the first write.
 */
const NO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

/**
 * The CSS property of one side.
 *
 * @param side - The side.
 * @returns The property name.
 */
function propertyOf(side: (typeof SIDES)[number]): string {
  return `--moku-device-safe-${side}`;
}

/**
 * Whether two sets of insets are the same on every side.
 *
 * @param a - One set.
 * @param b - The other.
 * @returns True when every side is equal.
 */
function sameInsets(a: SafeInsets, b: SafeInsets): boolean {
  return a.top === b.top && a.right === b.right && a.bottom === b.bottom && a.left === b.left;
}

/**
 * The document of the game frame, or undefined when there is none or it is another origin's.
 *
 * @param iframe - The game iframe.
 * @returns The document.
 */
function frameDocument(iframe: HTMLIFrameElement): Document | undefined {
  try {
    return iframe.contentDocument ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Writes the insets on `:root` of a document, or removes them when every side is 0.
 *
 * @param root - The document's root element.
 * @param safe - The insets.
 */
function writeInsets(root: HTMLElement, safe: SafeInsets): void {
  const none = sameInsets(safe, NO_INSETS);
  for (const side of SIDES) {
    if (none) root.style.removeProperty(propertyOf(side));
    else root.style.setProperty(propertyOf(side), `${safe[side]}px`);
  }
}

/**
 * Shows the safe insets of the screen in use on the game page, and tells the page when they
 * changed. Nothing is written or sent while the page already shows these insets, so the many
 * calls of a scroll or a resize cost one comparison each; a new document (a reload) is written
 * again.
 *
 * @param state - Workspace state.
 * @param safe - The safe insets of the screen in use (`resolveDevice`).
 */
export function syncInsets(state: WorkspaceState, safe: SafeInsets): void {
  const iframe = state.frame.iframe;
  const doc = iframe === undefined ? undefined : frameDocument(iframe);
  const root = doc?.documentElement;
  if (doc === undefined || root === undefined || root === null) return;

  // A page that shows these insets already, or a fresh page that needs none, is left as it is.
  const shown = state.frame.insets;
  const before = shown?.doc === doc ? shown.safe : NO_INSETS;
  if (sameInsets(safe, before)) return;

  state.frame.insets = { doc, safe };
  writeInsets(root, safe);
  const view = doc.defaultView;
  if (view !== null) view.dispatchEvent(new view.Event(INSETS_EVENT));
}
