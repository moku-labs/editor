/**
 * @file bridge plugin — device mode: which mode and address a page starts with (`resolveMode`,
 * pure), the pairing code, the credentials of a dial, the pairing handshake (`pair` first, then
 * `paired` stores the device id and token and runs the link step) and the 4401 `unpaired` rule.
 * Tokens and device ids are never logged: log lines name the address only.
 */
import type { PairParams } from "../../hub/protocol";
import { parseAddress } from "../../hub/protocol";
import type { Json } from "../../registry/protocol";
import { notification, toWireValue } from "../../registry/protocol";
import { memberOf } from "../dispatch/params";
import { sendNow } from "../dispatch/send";
import { pairDeviceOf } from "../pair-device";
import { setStatus } from "../status";
import type {
  BridgeConfig,
  BridgeDeps,
  BridgeMode,
  BridgeState,
  PageFlags,
  RememberedLink,
  RememberedLinks
} from "../types";
import { DEFAULT_DEVICE_ADDRESS } from "../types";
import { onLinked } from "./link";
import { forgetLink, rememberLink, writeRemembered } from "./pairing-store";

/**
 * What decides the mode at start.
 */
export type ModeInput = {
  readonly config: Readonly<BridgeConfig>;
  readonly flags: PageFlags;
  readonly href: string | undefined;
  readonly remembered: RememberedLinks;
};

/**
 * The mode and the address a page starts with.
 */
export type ResolvedMode = { readonly mode: BridgeMode; readonly address: string | undefined };

/**
 * The scope the pairing code takes its randomness from (`globalThis`).
 */
type RandomScope = {
  readonly crypto?: { getRandomValues<T extends ArrayBufferView>(array: T): T };
};

/** How many pairing codes there are: four decimal digits. */
const CODE_SPACE = 10_000;

/** The digits of a pairing code. */
const CODE_DIGITS = 4;

/** The host of the native WebView's page (Android `http://tauri.localhost`, native#19). */
const NATIVE_HOST = "tauri.localhost";

/**
 * The normalized address, or undefined when there is none or `parseAddress` refuses it.
 *
 * @param text - An address as configured or written by the build.
 * @returns The address text.
 * @example
 * ```ts
 * normalized(" My-PC.local:47600 "); // "my-pc.local:47600"
 * ```
 */
function normalized(text: string | undefined): string | undefined {
  return text === undefined ? undefined : parseAddress(text)?.text;
}

/**
 * True for a page no dev server served: no URL, not http(s) (`tauri://localhost` on iOS,
 * `file:`), or the native WebView's own host (`http://tauri.localhost` on Android).
 *
 * @param href - The page URL.
 * @returns Whether the page runs in a native shell.
 * @example
 * ```ts
 * isNativePage("tauri://localhost/index.html"); // true
 * ```
 */
function isNativePage(href: string | undefined): boolean {
  if (href === undefined) return true;
  try {
    const url = new URL(href);
    const web = url.protocol === "http:" || url.protocol === "https:";
    return !web || url.hostname === NATIVE_HOST;
  } catch {
    return true;
  }
}

/**
 * True for a hello route that names its server itself (an absolute http(s) URL): page mode then
 * needs no page URL (a headless agent in Bun linked to a dev server).
 *
 * @param hello - config.hello.
 * @returns Whether it is an absolute http(s) URL.
 * @example
 * ```ts
 * isAbsoluteHello("http://127.0.0.1:3000/__editor/hello"); // true
 * ```
 */
function isAbsoluteHello(hello: string): boolean {
  try {
    const { protocol } = new URL(hello);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The mode and the address at start, first match wins: (1) a debug build's
 * `__MOKU_GAME_EDITOR__` → device at the remembered address, else config.device, else the
 * build's; (2) config.device → device at the remembered address, else config.device; (3) a native
 * page → device at the remembered address, else DEFAULT_DEVICE_ADDRESS, except a page without a URL
 * whose hello names its server (a headless agent in Bun); (4) page mode. The remembered address wins: it was chosen on the device
 * later than the build was made. An address `parseAddress` refuses is skipped.
 *
 * @param input - Config, flags, page URL and the remembered links.
 * @returns The mode and the normalized address (undefined in page mode).
 * @example
 * ```ts
 * resolveMode({ config, flags: { editor: "127.0.0.1:47600", model: undefined, userAgent: undefined }, href: undefined, remembered });
 * // { mode: "device", address: "127.0.0.1:47600" }
 * ```
 */
export function resolveMode(input: ModeInput): ResolvedMode {
  const { config, flags, href, remembered } = input;
  const last = normalized(remembered.last);
  const configured = normalized(config.device);

  if (flags.editor !== undefined) {
    const address = last ?? configured ?? normalized(flags.editor) ?? DEFAULT_DEVICE_ADDRESS;
    return { mode: "device", address };
  }
  if (configured !== undefined) return { mode: "device", address: last ?? configured };
  const headless = href === undefined && isAbsoluteHello(config.hello);
  if (isNativePage(href) && !headless) {
    return { mode: "device", address: last ?? DEFAULT_DEVICE_ADDRESS };
  }
  return { mode: "page", address: undefined };
}

/**
 * A new pairing code: four decimal digits, leading zeros kept, from `crypto.getRandomValues` when
 * the page has it, else from `random`.
 *
 * @param random - A number in [0, 1) (`net.random`).
 * @param scope - Where to look for `crypto`.
 * @returns The code.
 * @example
 * ```ts
 * newCode(() => 0.0421, {}); // "0421"
 * ```
 */
export function newCode(random: () => number, scope: RandomScope = globalThis): string {
  const values =
    typeof scope.crypto?.getRandomValues === "function"
      ? scope.crypto.getRandomValues(new Uint32Array(1))
      : undefined;
  const value = values?.[0] ?? Math.floor(random() * CODE_SPACE);
  return String(value % CODE_SPACE).padStart(CODE_DIGITS, "0");
}

/**
 * The credentials of the next dial: none after a 4401 (`pairNext`), else the remembered ones for
 * the address.
 *
 * @param state - The bridge state.
 * @returns The device id and token, or undefined (the socket pairs).
 */
export function credentialsOf(state: BridgeState): RememberedLink | undefined {
  if (state.pairNext || state.address === undefined) return undefined;
  return state.remembered.links[state.address];
}

/**
 * A socket without credentials opened: phase pairing, the code (kept across retries), `pair {
 * code, device }` as the first message, and the code published. No bridge-side deadline: the hub
 * closes the socket when nobody answers.
 *
 * @param deps - The domain deps.
 */
export function startPairing(deps: BridgeDeps): void {
  const { state } = deps;
  state.phase = "pairing";
  state.pairing ??= { code: newCode(deps.net.random) };
  const pair: PairParams = {
    code: state.pairing.code,
    device: pairDeviceOf(deps.registry.build(), deps.flags)
  };
  sendNow(deps, notification("editor", "pair", toWireValue(pair)));
  setStatus(deps, { kind: "connecting" });
}

/**
 * A non-empty string member.
 *
 * @param params - The params.
 * @param key - The member.
 * @returns The string, or undefined.
 * @example
 * ```ts
 * textOf({ device: "d-7f3a" }, "device"); // "d-7f3a"
 * ```
 */
function textOf(params: Json | undefined, key: string): string | undefined {
  const value = memberOf(params, key);
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The hub's `paired { device, token, engine }` on a pairing socket: the device id and token are
 * remembered for the address (the newest, the last address), the code goes, the computer's
 * engine is kept, and the link step runs on the same socket. Ignored on any other socket.
 *
 * @param deps - The domain deps.
 * @param params - The notification's params.
 */
export function onPaired(deps: BridgeDeps, params: Json | undefined): void {
  const { state } = deps;
  const { address } = state;
  const device = textOf(params, "device");
  const token = textOf(params, "token");
  if (
    state.phase !== "pairing" ||
    address === undefined ||
    device === undefined ||
    token === undefined
  ) {
    deps.log.debug("bridge:paired-ignored", { phase: state.phase });
    return;
  }

  state.remembered = rememberLink(state.remembered, address, { device, token });
  writeRemembered(deps);
  state.pairing = undefined;
  state.pairNext = false;
  state.editorEngine = textOf(params, "engine") ?? state.editorEngine;
  deps.log.info("bridge:paired", { address });
  onLinked(deps);
}

/**
 * The hub closed a credentialed socket 4401 `unpaired` (it does not know this device id or
 * token, e.g. a restarted `moku-editor perf`): the address's credentials are dropped from the
 * store and the next socket pairs.
 *
 * @param deps - The domain deps.
 */
export function onUnpaired(deps: BridgeDeps): void {
  const { state } = deps;
  const { address } = state;
  if (address !== undefined) {
    state.remembered = forgetLink(state.remembered, address);
    writeRemembered(deps);
  }
  state.pairNext = true;
  deps.log.info("bridge:unpaired", { address });
}
