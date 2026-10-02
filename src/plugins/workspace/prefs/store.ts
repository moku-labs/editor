/**
 * @file workspace plugin — prefs/store.ts (skeleton stubs, implemented in its wave).
 */
import type { Log } from "@moku-labs/common/browser";
import type { StoredPrefs } from "../types";

/**
 * Skeleton stub for `loadPrefs`; implemented in its wave.
 *
 * @param _key - The key.
 * @param _log - The log.
 * @example
 * ```ts
 * loadPrefs();
 * ```
 */
export function loadPrefs(_key: string, _log: Log.LogApi): StoredPrefs {
  throw new Error("not implemented");
}

/**
 * Skeleton stub for `savePrefs`; implemented in its wave.
 *
 * @param _key - The key.
 * @param _prefs - The prefs.
 * @param _log - The log.
 * @example
 * ```ts
 * savePrefs();
 * ```
 */
export function savePrefs(_key: string, _prefs: StoredPrefs, _log: Log.LogApi): void {
  throw new Error("not implemented");
}
