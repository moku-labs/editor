/**
 * @file bridge plugin — config check and the editor.reload and editor.clock commands (onInit), the
 * domain deps, start (onStart: the remembered links, mode and address, heartbeat listener, page
 * and reload listeners, the checkpoint restore in page mode, connect — not awaited) and stop
 * (onStop: bye, close, clear timers and the ack deadline).
 */
import { channelPlugin } from "../channel";
import { parseAddress } from "../hub/protocol";
import { recorderPlugin } from "../recorder";
import { registryPlugin } from "../registry";
import { encode, notification } from "../registry/protocol";
import { restoreCheckpoint, takeStoredCheckpoint, watchReload } from "./checkpoint/checkpoint";
import { defaultReload } from "./checkpoint/hot";
import { clockEntry } from "./clock";
import { resolveMode } from "./connection/device";
import { connectInBackground, onBeat } from "./connection/loop";
import { readRemembered } from "./connection/pairing-store";
import { defaultNet } from "./connection/socket";
import { asError } from "./dispatch/dispatch";
import { dropInflight, NORMAL_CLOSE, SOCKET_OPEN } from "./dispatch/send";
import { dropAll } from "./dispatch/subscriptions";
import { dropShipping } from "./lines";
import { watchTaps, watchVisibility } from "./page";
import { readFlags } from "./pair-device";
import { reloadEntry } from "./reload";
import { setStatus } from "./status";
import type {
  BridgeConfig,
  BridgeCtx,
  BridgeDeps,
  BridgeState,
  CheckpointStorage,
  TakenCheckpoint
} from "./types";
import { DEFAULT_CALL_TIMEOUT_MS, DEFAULT_RETRY_MS, MAX_LINES_PER_BATCH } from "./types";

/**
 * The smallest retryMs and callTimeoutMs.
 */
const MIN_MS = 100;

/**
 * Builds a config error in the two-line format (spec/11 Part 3, R7 prefix), a TypeError (config
 * validation).
 *
 * @param field - The config field.
 * @param rule - What it must be.
 * @param example - A valid value, as written in code.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw configError("retryMs", "a whole number of at least 100", "1000");
 * ```
 */
function configError(field: string, rule: string, example: string): TypeError {
  return new TypeError(
    `[moku-editor] bridge.${field} must be ${rule}.\n  Fix pluginConfigs.bridge.${field}, for example ${example}.`
  );
}

/**
 * Rejects a value that is not a finite integer ≥ 100.
 *
 * @param field - The config field.
 * @param value - Its value.
 * @param example - Its default.
 * @throws {TypeError} `[moku-editor] bridge.<field> must be a whole number of at least 100.`
 * @example
 * ```ts
 * checkWhole("retryMs", 50, 1000); // throws
 * ```
 */
function checkWhole(field: string, value: number, example: number): void {
  if (Number.isInteger(value) && value >= MIN_MS) return;
  throw configError(field, `a whole number of at least ${String(MIN_MS)}`, String(example));
}

/**
 * onInit: `hello` non-empty; `retryMs`, `callTimeoutMs` finite integers ≥ 100; `device`, when
 * set, a `host:port` parseAddress takes; `linesPerBatch` a whole number from 1 to 1000.
 *
 * @param ctx - Plugin context.
 * @param ctx.config - Resolved plugin config.
 * @throws {TypeError} `[moku-editor] bridge.<field> must be <rule>.`
 */
export function checkConfig(ctx: { readonly config: Readonly<BridgeConfig> }): void {
  const { hello, retryMs, callTimeoutMs, device, linesPerBatch } = ctx.config;
  const isHelloSet = typeof hello === "string" && hello !== "";
  if (!isHelloSet) throw configError("hello", "a non-empty string", '"/__editor/hello"');

  checkWhole("retryMs", retryMs, DEFAULT_RETRY_MS);
  checkWhole("callTimeoutMs", callTimeoutMs, DEFAULT_CALL_TIMEOUT_MS);
  if (device !== undefined && (typeof device !== "string" || parseAddress(device) === undefined)) {
    throw new TypeError(
      '[moku-editor] bridge.device must be host:port, for example "192.168.1.5:47600".\n  Fix pluginConfigs.bridge.device, for example "127.0.0.1:47600".'
    );
  }
  const isBatch =
    Number.isInteger(linesPerBatch) && linesPerBatch >= 1 && linesPerBatch <= MAX_LINES_PER_BATCH;
  if (!isBatch) {
    throw configError("linesPerBatch", "a whole number from 1 to 1000", "200");
  }
}

/**
 * onInit: checks the config, then adds `editor.reload` and `editor.clock` to the registry, in that
 * order. Runs in init because the registry builds its manifest from the entries added before
 * start.
 *
 * @param ctx - Plugin context of the bridge.
 * @throws {TypeError} `[moku-editor] bridge.<field> must be <rule>.`
 * @throws {Error} When `editor.reload` or
 *   `editor.clock` is already in the registry (createApp fails loudly).
 */
export function initBridge(ctx: BridgeCtx): void {
  checkConfig(ctx);

  const registry = ctx.require(registryPlugin);
  registry.add(reloadEntry({ registry, reload: defaultReload(), state: ctx.state, log: ctx.log }));
  registry.add(clockEntry(registry));
}

/**
 * The page's localStorage for the remembered links, or undefined where there is none or touching
 * it throws (a WebView with storage off).
 *
 * @param scope - Where to look for `localStorage`.
 * @param scope.localStorage - The page's localStorage, if any.
 * @returns The storage, or undefined.
 * @example
 * ```ts
 * linkStorageOf({}); // undefined: no localStorage outside a browser
 * ```
 */
function linkStorageOf(scope: {
  readonly localStorage?: CheckpointStorage;
}): CheckpointStorage | undefined {
  try {
    return scope.localStorage;
  } catch {
    return undefined;
  }
}

/** The domain deps of each bridge state, built once. */
const known = new WeakMap<BridgeState, BridgeDeps>();

/**
 * The domain deps, built once per plugin state, so the api, the hooks and start share one
 * snapshot of the flags, the net and the page: registry, channel and recorder through
 * ctx.require, emit of bridge:status, defaultNet(globalThis), the reload seam, the page flags, the
 * link storage and the page probe (URL, document, window).
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The deps every bridge module takes.
 */
export function depsOf(ctx: BridgeCtx): BridgeDeps {
  const cached = known.get(ctx.state);
  if (cached !== undefined) return cached;
  const deps = buildDeps(ctx);
  known.set(ctx.state, deps);
  return deps;
}

/**
 * Builds the domain deps of `ctx` (see depsOf).
 *
 * @param ctx - Plugin context of the bridge.
 * @returns The deps.
 */
function buildDeps(ctx: BridgeCtx): BridgeDeps {
  return {
    config: ctx.config,
    state: ctx.state,
    log: ctx.log,
    /**
     * Emits the global agent event (fire and forget).
     *
     * @param payload - The status and the session.
     */
    emit: payload => {
      ctx.emit("bridge:status", payload);
    },
    registry: ctx.require(registryPlugin),
    channel: ctx.require(channelPlugin),
    recorder: ctx.require(recorderPlugin),
    net: defaultNet(globalThis),
    flags: readFlags(globalThis),
    linkStorage: linkStorageOf(globalThis),
    reload: defaultReload(),
    page: {
      href: globalThis.location?.href,
      document: globalThis.document,
      window: globalThis.window
    }
  };
}

/**
 * Restores the checkpoint the previous document stored, then connects, so the first hello
 * carries `restored`. Never throws: a crash is logged.
 *
 * @param deps - The domain deps.
 * @param checkpoint - The checkpoint to restore.
 */
function restoreThenConnect(deps: BridgeDeps, checkpoint: TakenCheckpoint): void {
  restoreCheckpoint(deps, checkpoint)
    .then(() => {
      connectInBackground(deps);
    })
    .catch((error: unknown) => {
      deps.log.error("bridge:connect-crashed", undefined, asError(error));
    });
}

/**
 * Reads the remembered links and decides the mode and the address. A `connect` before start
 * already chose device mode; that choice stays. A build address `parseAddress` refuses is
 * warned about once (the engine's `--editor` rule is wider than ours).
 *
 * @param deps - The domain deps.
 */
function resolveStart(deps: BridgeDeps): void {
  const { state, flags, config } = deps;
  state.remembered = readRemembered(deps);
  if (flags.editor !== undefined && parseAddress(flags.editor) === undefined) {
    deps.log.warn("bridge:bad-address", { address: flags.editor });
  }
  if (state.mode === "device") return;

  const resolved = resolveMode({
    config,
    flags,
    href: deps.page.href,
    remembered: state.remembered
  });
  state.mode = resolved.mode;
  state.address = resolved.address;
}

/**
 * Starts the bridge over its deps: the remembered links, mode and address, connecting announced,
 * the heartbeat, visibility, tap and reload listeners, then a connect without awaiting:
 * `app.start()` never waits for, or fails on, a computer. In page mode a checkpoint stored before
 * Bun's full reload is restored first (R6); a device page has no Bun HMR.
 *
 * @param deps - The domain deps.
 */
export function startWith(deps: BridgeDeps): void {
  resolveStart(deps);
  setStatus(deps, { kind: "connecting" }, true);
  deps.state.off.push(
    deps.channel.onHeartbeat(beat => {
      onBeat(deps, beat);
    }),
    watchVisibility(deps),
    watchTaps(deps),
    watchReload(deps)
  );

  const checkpoint = deps.state.mode === "page" ? takeStoredCheckpoint(deps) : undefined;
  if (checkpoint === undefined) connectInBackground(deps);
  else restoreThenConnect(deps, checkpoint);
}

/**
 * onStart: starts the bridge over the deps of `ctx`.
 *
 * @param ctx - Plugin context of the bridge.
 */
export function startBridge(ctx: BridgeCtx): void {
  startWith(depsOf(ctx));
}

/**
 * onStop: phase stopped, timers cleared (the ack deadline too), listeners removed, subs stopped,
 * bye + normal close. The remembered links stay in storage. Teardown context only: no emit, no
 * log.
 *
 * @param ctx - Teardown context.
 * @param ctx.state - Own state.
 */
export function stopBridge(ctx: { readonly state: BridgeState }): void {
  const { state } = ctx;

  // Nothing may act again: no retry, no deadline, no listener, no subscription.
  state.phase = "stopped";
  if (state.retryTimer !== undefined) clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
  dropInflight(state);
  dropShipping(state);
  for (const off of state.off.splice(0)) off();
  dropAll({ state });

  // Forget the socket; say bye on it when it is open, then close it.
  const { socket } = state;
  state.socket = undefined;
  state.session = undefined;
  if (socket === undefined) return;
  if (socket.readyState !== SOCKET_OPEN) {
    socket.close();
    return;
  }
  socket.send(encode(notification("game", "bye")));
  socket.close(NORMAL_CLOSE, "bye");
}
