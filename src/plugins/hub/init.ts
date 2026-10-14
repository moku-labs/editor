/**
 * @file hub plugin — the onInit body: validates path, allowOrigins, callTimeoutMs, silentAfterMs,
 * the six device-mode fields (devicePort, deviceLan, lanAddress, deviceOrigins, pairing,
 * pairTimeoutMs) and builds state.origins and state.deviceOrigins. Synchronous, so createApp fails
 * early on a bad config. The device-mode fields fail with a TypeError (config validation).
 */
import { isIP } from "node:net";
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
 * The highest TCP port.
 */
const MAX_PORT = 65_535;

/**
 * The shortest pairing wait the hub accepts, in ms.
 */
const MIN_PAIR_MS = 1000;

/**
 * The schemes a device WebView origin may have.
 */
const DEVICE_SCHEMES: ReadonlySet<string> = new Set(["tauri:", "http:", "https:"]);

/**
 * The pairing policies.
 */
const PAIRINGS: ReadonlySet<unknown> = new Set(["lan", "always"]);

/**
 * A device-mode config error: a TypeError in the spec/11 Part 3 format,
 * `[moku-editor] hub.<field> is <value>.` and the rule with an example.
 *
 * @param field - The config field.
 * @param value - The configured value.
 * @param rule - The rule with an example, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * deviceConfigError("pairing", "never", 'Pass "lan" or "always"').message; // '[moku-editor] hub.pairing is "never".\n  Pass "lan" or "always".'
 * ```
 */
function deviceConfigError(field: string, value: unknown, rule: string): TypeError {
  const shown = typeof value === "string" ? JSON.stringify(value) : String(value);
  return new TypeError(`[moku-editor] hub.${field} is ${shown}.\n  ${rule}.`);
}

/**
 * True for an exact device origin: it parses, its scheme is tauri:, http: or https:, and it is
 * exactly `<scheme>//<host>` (no path, no trailing slash, lower case). The check is on scheme and
 * host, never on `URL.origin`, which is "null" for `tauri:`.
 *
 * @param entry - A config.deviceOrigins entry.
 * @returns Whether it is a device origin.
 * @example
 * ```ts
 * isDeviceOrigin("tauri://localhost"); // true
 * ```
 */
function isDeviceOrigin(entry: unknown): entry is string {
  if (typeof entry !== "string" || !URL.canParse(entry)) return false;

  // A tauri: host is opaque: URL keeps its case, so the lower case is checked on the entry itself.
  const url = new URL(entry);
  return (
    DEVICE_SCHEMES.has(url.protocol) &&
    `${url.protocol}//${url.host}` === entry &&
    entry === entry.toLowerCase()
  );
}

/**
 * Checks config.deviceOrigins.
 *
 * @param deviceOrigins - The configured device origins.
 * @returns The origins.
 * @throws {TypeError} When it is not a list of exact device origins.
 * @example
 * ```ts
 * checkDeviceOrigins(["tauri://localhost"]); // ["tauri://localhost"]
 * ```
 */
function checkDeviceOrigins(deviceOrigins: unknown): readonly string[] {
  const rule =
    'List exact origins (scheme tauri:, http: or https:, a host, no path, no trailing slash, lower case) in pluginConfigs.hub.deviceOrigins, for example ["tauri://localhost"]';
  if (!Array.isArray(deviceOrigins)) throw deviceConfigError("deviceOrigins", deviceOrigins, rule);

  const origins: string[] = [];
  for (const entry of deviceOrigins) {
    if (!isDeviceOrigin(entry)) throw deviceConfigError("deviceOrigins", entry, rule);
    origins.push(entry);
  }
  return origins;
}

/**
 * Checks the device-mode fields other than deviceOrigins.
 *
 * @param config - The resolved config.
 * @param config.devicePort - Port of the device listeners.
 * @param config.deviceLan - Whether to listen on the LAN too.
 * @param config.lanAddress - The LAN address, or undefined.
 * @param config.pairing - The pairing policy.
 * @param config.pairTimeoutMs - The pairing wait.
 * @throws {TypeError} On the first field that breaks its rule.
 */
function checkDeviceFields(config: HubCtx["config"]): void {
  const { devicePort, deviceLan, lanAddress, pairing, pairTimeoutMs } = config;
  if (!Number.isInteger(devicePort) || devicePort < 0 || devicePort > MAX_PORT) {
    throw deviceConfigError(
      "devicePort",
      devicePort,
      "Pass an integer from 0 to 65535 in pluginConfigs.hub.devicePort (0 picks a free port), for example 47600"
    );
  }
  if (typeof deviceLan !== "boolean") {
    throw deviceConfigError(
      "deviceLan",
      deviceLan,
      "Pass true or false in pluginConfigs.hub.deviceLan"
    );
  }
  if (lanAddress !== undefined && (typeof lanAddress !== "string" || isIP(lanAddress) === 0)) {
    throw deviceConfigError(
      "lanAddress",
      lanAddress,
      'Leave pluginConfigs.hub.lanAddress unset or pass an IPv4 or IPv6 address, for example "192.168.1.5"'
    );
  }
  if (!PAIRINGS.has(pairing)) {
    throw deviceConfigError(
      "pairing",
      pairing,
      'Pass "lan" or "always" in pluginConfigs.hub.pairing'
    );
  }
  if (!Number.isInteger(pairTimeoutMs) || pairTimeoutMs < MIN_PAIR_MS) {
    throw deviceConfigError(
      "pairTimeoutMs",
      pairTimeoutMs,
      `Pass an integer of at least ${MIN_PAIR_MS} ms in pluginConfigs.hub.pairTimeoutMs, for example 60000`
    );
  }
}

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
 * @param entry - A config.allowOrigins entry.
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
 * Checks config.allowOrigins.
 *
 * @param allowOrigins - The configured extra origins.
 * @returns The origins.
 * @throws {Error} When it is not a list of bare http(s) origins.
 * @example
 * ```ts
 * checkAllowOrigins(["http://192.168.1.4:3000"]); // ["http://192.168.1.4:3000"]
 * ```
 */
function checkAllowOrigins(allowOrigins: unknown): readonly string[] {
  if (!Array.isArray(allowOrigins)) {
    throw configError(
      "hub.allowOrigins must be a list of origins",
      'Pass pluginConfigs.hub.allowOrigins as a list, for example ["http://192.168.1.4:3000"]'
    );
  }

  const origins: string[] = [];
  for (const entry of allowOrigins) {
    if (!isOrigin(entry)) {
      throw configError(
        `hub.allowOrigins entry "${String(entry)}" is not an http(s) origin`,
        'List origins like "http://192.168.1.4:3000" (no path, no trailing slash) in pluginConfigs.hub.allowOrigins'
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
 * state.origins from config.allowOrigins and state.deviceOrigins from config.deviceOrigins.
 *
 * @param ctx - Domain context of the hub.
 * @throws {Error} On a bad path, allowOrigins entry, callTimeoutMs or silentAfterMs.
 * @throws {TypeError} On a bad devicePort, deviceLan, lanAddress, deviceOrigins entry, pairing or
 * pairTimeoutMs.
 */
export function validateHubConfig(ctx: HubCtx): void {
  const { path, allowOrigins, callTimeoutMs, silentAfterMs, deviceOrigins } = ctx.config;

  checkPath(path);
  const origins = checkAllowOrigins(allowOrigins);
  checkMs("callTimeoutMs", callTimeoutMs, 5000);
  checkMs("silentAfterMs", silentAfterMs, 6000);
  checkDeviceFields(ctx.config);
  const devices = checkDeviceOrigins(deviceOrigins);

  ctx.state.origins = new Set(origins);
  ctx.state.deviceOrigins = new Set(devices);
}
