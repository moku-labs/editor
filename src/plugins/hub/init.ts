/**
 * @file hub plugin — the onInit body: validates path, allow, callTimeoutMs, silentAfterMs and
 * builds state.origins. Synchronous, so createApp fails early on a bad config.
 */
import type { HubCtx } from "./types";

/**
 * A valid editor path: starts with "/", letters, digits, "_", "-" and "/", no trailing slash.
 */
const PATH_PATTERN = /^\/[\w/-]*[\w-]$/;

/**
 * The smallest timeout the hub accepts, in ms.
 */
const MIN_MS = 100;

/**
 * A config error in the spec/11 Part 3 format with the editor prefix (R7).
 *
 * @param problem - What is wrong, without the final period.
 * @param fix - How to fix it, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw configError('hub.path "/x/" is not valid', 'Fix pluginConfigs.hub.path, for example "/__editor"');
 * ```
 */
function configError(problem: string, fix: string): Error {
  return new Error(`[moku-editor] ${problem}.\n  ${fix}.`);
}

/**
 * True for a bare http(s) origin: parses, and equals its own origin (no path, no slash).
 *
 * @param entry - A config.allow entry.
 * @returns Whether it is an origin.
 * @example
 * ```ts
 * isOrigin("http://192.168.1.4:3000"); // true
 * ```
 */
function isOrigin(entry: unknown): entry is string {
  if (typeof entry !== "string" || !URL.canParse(entry)) return false;

  const url = new URL(entry);
  return (url.protocol === "http:" || url.protocol === "https:") && url.origin === entry;
}

/**
 * Checks config.path.
 *
 * @param path - The configured path.
 * @throws {Error} When it is not a valid editor path.
 * @example
 * ```ts
 * checkPath("/__editor");
 * ```
 */
function checkPath(path: unknown): void {
  if (typeof path === "string" && PATH_PATTERN.test(path) && !path.includes("//")) return;

  throw configError(
    `hub.path "${String(path)}" must start with "/", use letters, digits, "_", "-" or "/", and have no trailing or double slash`,
    'Fix pluginConfigs.hub.path, for example "/__editor"'
  );
}

/**
 * Checks config.allow.
 *
 * @param allow - The configured extra origins.
 * @returns The origins.
 * @throws {Error} When it is not a list of bare http(s) origins.
 * @example
 * ```ts
 * checkAllow(["http://192.168.1.4:3000"]);
 * ```
 */
function checkAllow(allow: unknown): readonly string[] {
  if (!Array.isArray(allow)) {
    throw configError(
      "hub.allow must be a list of origins",
      'Pass pluginConfigs.hub.allow as a list, for example ["http://192.168.1.4:3000"]'
    );
  }

  const origins: string[] = [];
  for (const entry of allow) {
    if (!isOrigin(entry)) {
      throw configError(
        `hub.allow entry "${String(entry)}" is not an http(s) origin`,
        'List origins like "http://192.168.1.4:3000" (no path, no trailing slash) in pluginConfigs.hub.allow'
      );
    }
    origins.push(entry);
  }
  return origins;
}

/**
 * Checks a timeout field: a finite integer of at least 100 ms.
 *
 * @param field - The field name.
 * @param value - The configured value.
 * @param example - The default, for the fix line.
 * @throws {Error} When the value is out of range.
 * @example
 * ```ts
 * checkMs("callTimeoutMs", 5000, 5000);
 * ```
 */
function checkMs(field: string, value: unknown, example: number): void {
  if (Number.isInteger(value) && typeof value === "number" && value >= MIN_MS) return;

  throw configError(
    `hub.${field} must be an integer of at least ${MIN_MS} ms, got ${String(value)}`,
    `Fix pluginConfigs.hub.${field}, for example ${example}`
  );
}

/**
 * Validates the config (spec/11 Part 3 format, `[moku-editor] hub.<field> …`) and builds
 * state.origins from config.allow.
 *
 * @param ctx - Domain context of the hub.
 * @throws {Error} On a bad path, allow entry, callTimeoutMs or silentAfterMs.
 */
export function validateHubConfig(ctx: HubCtx): void {
  const { path, allow, callTimeoutMs, silentAfterMs } = ctx.config;

  checkPath(path);
  const origins = checkAllow(allow);
  checkMs("callTimeoutMs", callTimeoutMs, 5000);
  checkMs("silentAfterMs", silentAfterMs, 6000);

  ctx.state.origins = new Set(origins);
}
