/**
 * @file bridge plugin — device mode: which mode and address a page starts with (`resolveMode`,
 * pure), the pairing code, the credentials of a dial, the pairing handshake (`pair` first, then
 * `paired` stores the device id and token and runs the link step) and the 4401 `unpaired` rule.
 * Tokens and device ids are never logged: log lines name the address only.
 */
import type { PairParams } from "../../hub/protocol";
import { isLoopback, parseAddress } from "../../hub/protocol";
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
  Phase,
  RememberedLink,
  RememberedLinks
} from "../types";
import { DEFAULT_DEVICE_ADDRESS, MAX_REMEMBERED } from "../types";
import { onLinked } from "./link";
import { forgetLink, rememberLast, rememberLink, writeRemembered } from "./pairing-store";

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

  // 1. A debug build: its `--editor` wrote the computer's address (__MOKU_GAME_EDITOR__).
  if (flags.editor !== undefined) {
    const address = last ?? configured ?? normalized(flags.editor) ?? DEFAULT_DEVICE_ADDRESS;
    return { mode: "device", address };
  }
  // 2. The developer configured a computer address.
  if (configured !== undefined) return { mode: "device", address: last ?? configured };
  // 3. A native WebView page no dev server served; a page without a URL whose hello names its
  //    server is a headless agent and stays in page mode.
  const headless = href === undefined && isAbsoluteHello(config.hello);
  if (isNativePage(href) && !headless) {
    return { mode: "device", address: last ?? DEFAULT_DEVICE_ADDRESS };
  }
  // 4. A page the dev server served.
  return { mode: "page", address: undefined };
}

/** The most candidates: the first address, the wire and every remembered address. */
const MAX_CANDIDATES = MAX_REMEMBERED + 2;

/**
 * The addresses a device tries in turn while none answers (Delta 2026-10-18): the first one (where
 * it last linked, or the address it was given), the wire (`DEFAULT_DEVICE_ADDRESS`, `adb reverse`)
 * unless the first is a loopback address already (that is a wire), then the other remembered
 * addresses, newest first; each once, at most MAX_CANDIDATES (the oldest remembered dropped).
 *
 * @param first - The address to try first (normalized).
 * @param remembered - The remembered links.
 * @returns The candidates, the first one first.
 * @example
 * ```ts
 * candidatesOf("192.168.2.223:47600", { v: 1, last: undefined, links: {} }); // ["192.168.2.223:47600", "127.0.0.1:47600"]
 * ```
 */
export function candidatesOf(first: string, remembered: RememberedLinks): string[] {
  const newestFirst = Object.keys(remembered.links).toReversed();
  const host = parseAddress(first)?.host;
  const wired = host !== undefined && isLoopback(host);
  const all = wired ? [first, ...newestFirst] : [first, DEFAULT_DEVICE_ADDRESS, ...newestFirst];
  const seen: string[] = [];
  for (const address of all) {
    const text = normalized(address);
    if (text !== undefined && !seen.includes(text)) seen.push(text);
  }
  return seen.slice(0, MAX_CANDIDATES);
}

/**
 * Device mode: the candidates start at an address (the start, `connect(address)`, a link).
 *
 * @param state - The bridge state.
 * @param address - The address to try first.
 */
export function startCandidatesAt(state: BridgeState, address: string): void {
  state.candidates = candidatesOf(address, state.remembered);
  state.candidate = 0;
}

/**
 * Device mode, a dial that never opened: the next candidate becomes the address (wrapping round).
 * The pairing code is kept (the phone shows it); `pairNext` is cleared, because it named the address
 * a 4401 dropped, and the next candidate dials with its own remembered credentials.
 *
 * @param deps - The domain deps.
 */
export function rotateCandidate(deps: BridgeDeps): void {
  const { state } = deps;
  if (state.mode !== "device" || state.candidates.length < 2) return;
  state.candidate = (state.candidate + 1) % state.candidates.length;
  state.address = state.candidates[state.candidate];
  state.pairNext = false;
  deps.log.debug("bridge:try-address", { address: state.address });
}

/**
 * Device mode, the computer answered with a session: the address is remembered as the last one
 * (the next launch starts there) and the candidates start at it.
 *
 * @param deps - The domain deps.
 */
export function adoptLinkedAddress(deps: BridgeDeps): void {
  const { state } = deps;
  const { address } = state;
  if (state.mode !== "device" || address === undefined) return;
  state.remembered = rememberLast(state.remembered, address);
  writeRemembered(deps);
  startCandidatesAt(state, address);
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
 * newCode(() => 0.5, {}); // "5000"
 * newCode(() => 0.0421, {}); // "0421": leading zeros kept
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
 * True for a `paired` that answers a pairing socket and carries both a device id and a token.
 *
 * @param phase - The connection phase.
 * @param reply - The device id and token the notification carried.
 * @param reply.device - The device id, if any.
 * @param reply.token - The token, if any.
 * @returns Whether the reply pairs this socket.
 * @example
 * ```ts
 * isPairingReply("pairing", { device: "d-7f3a", token: "t1" }); // true
 * ```
 */
function isPairingReply(
  phase: Phase,
  reply: { readonly device: string | undefined; readonly token: string | undefined }
): reply is RememberedLink {
  return phase === "pairing" && reply.device !== undefined && reply.token !== undefined;
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
  const reply = { device: textOf(params, "device"), token: textOf(params, "token") };
  if (address === undefined || !isPairingReply(state.phase, reply)) {
    deps.log.debug("bridge:paired-ignored", { phase: state.phase });
    return;
  }

  // Remember: the device id and token for this address (the newest, the last address), stored.
  state.remembered = rememberLink(state.remembered, address, {
    device: reply.device,
    token: reply.token
  });
  writeRemembered(deps);

  // Reset pairing: the code goes, the next socket dials with the credentials; the computer's
  // engine is kept.
  state.pairing = undefined;
  state.pairNext = false;
  state.editorEngine = textOf(params, "engine") ?? state.editorEngine;

  // Link: the link step runs on the same socket.
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
