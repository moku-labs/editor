/**
 * @file Shared view module — side-panel: the state of every SidePanel by id (D-29). The stored
 * part `{ width, collapsed, closed }` lives in localStorage under `moku-editor:panel:<id>`, a
 * per-viewer convenience; every storage access is in try/catch, and a memory copy keeps the panel
 * right while storage fails. The session part (overlay mode, the drawer) is never stored.
 */
import type { Json } from "../../../registry/protocol";

/**
 * The state of one side panel.
 *
 * @example
 * ```ts
 * const state: SidePanelState = { width: 400, collapsed: false, closed: false, overlay: false, drawer: false };
 * ```
 */
export type SidePanelState = {
  /** The width the person gave it in px; undefined until resized (the panel's default applies). */
  readonly width: number | undefined;
  /** Docked as the 32 px rail. */
  readonly collapsed: boolean;
  /** Hidden; the view shows a reopen button. */
  readonly closed: boolean;
  /** Session: its container is narrower than `overlayBelow`, so it floats over the content. */
  readonly overlay: boolean;
  /** Session: the floating panel is open. Overlay mode starts with it shut. */
  readonly drawer: boolean;
};

/**
 * The part of the state kept in localStorage.
 */
type StoredPanel = Pick<SidePanelState, "width" | "collapsed" | "closed">;

/**
 * A record read back from localStorage: an old or hand-edited one may miss a field or hold
 * another type in it.
 */
type StoredRecord = {
  readonly width?: Json;
  readonly collapsed?: Json;
  readonly closed?: Json;
};

/**
 * The part of the state kept for the session only.
 */
type SessionPanel = Pick<SidePanelState, "overlay" | "drawer">;

/**
 * The prefix of the localStorage key of a panel.
 */
const KEY_PREFIX = "moku-editor:panel:";

/**
 * The stored part of a panel never seen.
 */
const STORED_DEFAULTS: StoredPanel = { width: undefined, collapsed: false, closed: false };

/**
 * The session part of a panel never mounted.
 */
const SESSION_DEFAULTS: SessionPanel = { overlay: false, drawer: false };

/**
 * The stored part of the panels whose last write failed (no storage, storage full or denied).
 */
const held = new Map<string, StoredPanel>();

/**
 * The session part of every panel seen.
 */
const sessions = new Map<string, SessionPanel>();

/**
 * The listeners of every panel.
 */
const listeners = new Map<string, Set<() => void>>();

/**
 * Clamps a width to [min, max]; a width that is not a finite number gives min.
 *
 * @param width - The width in px.
 * @param min - The smallest width.
 * @param max - The largest width.
 * @returns The width inside the bounds.
 * @example
 * ```ts
 * clampWidth(900, 220, 560); // 560
 * clampWidth(300, 220, 560); // 300
 * ```
 */
export function clampWidth(width: number, min: number, max: number): number {
  if (!Number.isFinite(width)) return min;

  return Math.min(Math.max(width, min), max);
}

/**
 * Tells a stored record (a JSON object) from the other parsed values.
 *
 * @param value - What JSON.parse gave.
 * @returns True for an object that is not an array.
 */
function isStoredRecord(value: unknown): value is StoredRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the stored part of a record field by field: a field of the wrong type takes its default.
 *
 * @param text - The stored JSON text.
 * @returns The stored part.
 * @example
 * ```ts
 * parseStored('{"width":380,"closed":true}'); // { width: 380, collapsed: false, closed: true }
 * ```
 */
function parseStored(text: string): StoredPanel {
  let record: unknown;
  try {
    record = JSON.parse(text);
  } catch {
    return STORED_DEFAULTS;
  }
  if (!isStoredRecord(record)) return STORED_DEFAULTS;

  const { width, collapsed, closed } = record;
  const isWidth = typeof width === "number" && Number.isFinite(width) && width > 0;

  return {
    width: isWidth ? width : undefined,
    collapsed: collapsed === true,
    closed: closed === true
  };
}

/**
 * The stored part of a panel: the memory copy after a failed write, else localStorage, else the
 * defaults.
 *
 * @param id - The panel id.
 * @returns The stored part.
 */
function readStored(id: string): StoredPanel {
  const copy = held.get(id);
  if (copy !== undefined) return copy;

  const storage: Storage | undefined = globalThis.localStorage;
  try {
    const text = storage?.getItem(KEY_PREFIX + id);
    return typeof text === "string" ? parseStored(text) : STORED_DEFAULTS;
  } catch {
    return STORED_DEFAULTS;
  }
}

/**
 * Writes the stored part of a panel; keeps a memory copy when storage is missing or throws.
 *
 * @param id - The panel id.
 * @param stored - The stored part.
 */
function writeStored(id: string, stored: StoredPanel): void {
  const storage: Storage | undefined = globalThis.localStorage;
  const record = { width: stored.width, collapsed: stored.collapsed, closed: stored.closed };

  try {
    if (storage === undefined) throw new Error("no localStorage");
    storage.setItem(KEY_PREFIX + id, JSON.stringify(record));
    held.delete(id);
  } catch {
    held.set(id, stored);
  }
}

/**
 * The state of a side panel: the stored part and the session part. Defaults for a panel never seen.
 *
 * @param id - The panel id, e.g. "flow.inspector".
 * @returns The state.
 * @example
 * ```ts
 * // A palette item that only shows while the panel is closed.
 * palette.add({ id: "flow:show-inspector", label: "Show Inspector", when: () => sidePanelState("flow.inspector").closed, run: () => showSidePanel("flow.inspector") });
 * ```
 */
export function sidePanelState(id: string): SidePanelState {
  return { ...readStored(id), ...(sessions.get(id) ?? SESSION_DEFAULTS) };
}

/**
 * Changes the state of a side panel: stores the stored part when it changed, keeps the session
 * part in memory, and tells the panel's listeners. A patch that changes nothing does nothing.
 *
 * @param id - The panel id.
 * @param patch - The fields to change.
 * @example
 * ```ts
 * updateSidePanel("flow.inspector", { width: 400 }); // localStorage["moku-editor:panel:flow.inspector"] holds width 400
 * ```
 */
export function updateSidePanel(id: string, patch: Partial<SidePanelState>): void {
  const before = sidePanelState(id);
  const next = { ...before, ...patch };
  const isStoredChange =
    next.width !== before.width ||
    next.collapsed !== before.collapsed ||
    next.closed !== before.closed;
  const isSessionChange = next.overlay !== before.overlay || next.drawer !== before.drawer;

  if (!isStoredChange && !isSessionChange) return;

  if (isStoredChange) {
    writeStored(id, { width: next.width, collapsed: next.collapsed, closed: next.closed });
  }
  sessions.set(id, { overlay: next.overlay, drawer: next.drawer });

  for (const listener of listeners.get(id) ?? []) listener();
}

/**
 * Calls a listener on every change of a side panel's state.
 *
 * @param id - The panel id.
 * @param listener - Called after each change.
 * @returns Stops the calls.
 * @example
 * ```ts
 * const stop = subscribeSidePanel("files.tree", () => rerender());
 * stop();
 * ```
 */
export function subscribeSidePanel(id: string, listener: () => void): () => void {
  const set = listeners.get(id) ?? new Set<() => void>();
  set.add(listener);
  listeners.set(id, set);

  return () => {
    set.delete(listener);
  };
}

/**
 * Shows a side panel expanded: open again when closed; in overlay mode with its drawer open (the
 * docked choice stays), docked not collapsed.
 *
 * @param id - The panel id.
 * @example
 * ```ts
 * // The palette item "Show Inspector" of flowView.
 * palette.add({ id: "flow:show-inspector", label: "Show Inspector", run: () => showSidePanel("flow.inspector") });
 * ```
 */
export function showSidePanel(id: string): void {
  const state = sidePanelState(id);

  if (state.overlay) updateSidePanel(id, { closed: false, drawer: true });
  else updateSidePanel(id, { closed: false, collapsed: false });
}

/**
 * Toggles a side panel: shows a closed one; else opens or shuts the drawer in overlay mode, and
 * collapses or expands it docked. The view binds it to `\`.
 *
 * @param id - The panel id.
 * @example
 * ```ts
 * keys.add({ key: "\\", run: () => toggleSidePanel("game.side") });
 * ```
 */
export function toggleSidePanel(id: string): void {
  const state = sidePanelState(id);

  if (state.closed) showSidePanel(id);
  else if (state.overlay) updateSidePanel(id, { drawer: !state.drawer });
  else updateSidePanel(id, { collapsed: !state.collapsed });
}
