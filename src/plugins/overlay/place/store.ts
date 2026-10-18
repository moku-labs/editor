/**
 * @file overlay plugin — the remembered window: place, mode, last visible mode and tab in
 * `localStorage["moku-editor:overlay"]`. Every access is wrapped: a WebView with storage off, a
 * private window or a quota error logs debug once and the window works from memory.
 */
import type { OverlayCtx, OverlayMode, OverlayTab, StoredOverlay } from "../types";
import { STORE_KEY } from "../types";

/** The modes a stored record may name. */
const MODES: ReadonlySet<unknown> = new Set<OverlayMode>(["hidden", "pill", "card"]);

/** The tabs a stored record may name. */
const TABS: ReadonlySet<unknown> = new Set<OverlayTab>(["frames", "game", "record", "link"]);

/**
 * True for a plain object.
 *
 * @param value - Anything.
 * @returns Whether it is a non-null, non-array object.
 * @example
 * ```ts
 * isRecord({ v: 1 }); // true
 * ```
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * True for a valid place: a dock and a share from 0 to 1.
 *
 * @param value - Anything.
 * @returns Whether it is a place.
 * @example
 * ```ts
 * isPlace({ dock: "left", y: 0.5 }); // true
 * ```
 */
function isPlace(value: unknown): boolean {
  if (!isRecord(value)) return false;
  const { dock, y } = value;
  return (dock === "left" || dock === "right") && typeof y === "number" && y >= 0 && y <= 1;
}

/**
 * Reads a stored record: anything that is not a valid `StoredOverlay` (another version, an
 * unknown mode or tab, a share outside 0–1, text that is not JSON) is ignored.
 *
 * @param text - The stored text, or null.
 * @returns The record, or undefined.
 * @example
 * ```ts
 * parseStored('{"v":2}'); // undefined
 * ```
 */
export function parseStored(text: string | null): StoredOverlay | undefined {
  if (text === null) return undefined;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isRecord(value)) return undefined;

  const { v, mode, last, tab, place } = value;
  const valid =
    v === 1 &&
    MODES.has(mode) &&
    (last === "pill" || last === "card") &&
    TABS.has(tab) &&
    isPlace(place);
  // boundary: every field was checked above
  return valid ? (value as StoredOverlay) : undefined;
}

/**
 * Logs the first storage failure at debug.
 *
 * @param octx - Domain context.
 * @param error - What the storage threw.
 */
function storageFailed(octx: OverlayCtx, error: unknown): void {
  if (octx.state.storageFailed) return;
  octx.state.storageFailed = true;
  octx.log.debug("overlay:storage-failed", {
    message: error instanceof Error ? error.message : String(error)
  });
}

/**
 * Reads the remembered window; nothing with `remember: false`.
 *
 * @param octx - Domain context.
 * @returns The record, or undefined.
 */
export function readStored(octx: OverlayCtx): StoredOverlay | undefined {
  if (!octx.config.remember) return undefined;
  try {
    return parseStored(globalThis.localStorage.getItem(STORE_KEY));
  } catch (error) {
    storageFailed(octx, error);
    return undefined;
  }
}

/**
 * Writes the state's mode, last visible mode, tab and place; nothing with `remember: false`.
 *
 * @param octx - Domain context.
 */
export function writeStored(octx: OverlayCtx): void {
  if (!octx.config.remember) return;
  const { mode, last, tab, place } = octx.state;
  const record: StoredOverlay = { v: 1, mode, last, tab, place };
  try {
    globalThis.localStorage.setItem(STORE_KEY, JSON.stringify(record));
  } catch (error) {
    storageFailed(octx, error);
  }
}
