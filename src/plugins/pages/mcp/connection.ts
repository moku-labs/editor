/**
 * @file pages/mcp — the bin side of the bridge (M3): a live `.moku/editor.json` under the root
 * wins; without one the bridge starts the bin when it knows the game html (argv or the last
 * discovery file it saw). A hub socket that closes is reconnected: one try at the close, then at
 * most three more, 1, 2 and 4 s apart, each after the discovery file was read again, so the
 * bridge is back after the bin's restart (D-32, D-57, D-59). A connection the hub drops within
 * 5 s counts as a failed try. The bridge stops only a bin it started.
 */
import { resolve } from "node:path/posix";
import type { EditorDiscovery, McpArgs } from "../types";
import { findEditor } from "./discovery";
import type { HubClientOptions } from "./hub-client";
import { connectHub } from "./hub-client";
import { launchEditor, stopChild } from "./launcher";
import type { BridgeDeps, ChildProcess, EditorLink, EditorStatus, HubClient } from "./types";

/**
 * The port of a bin the bridge starts when neither the call, argv nor the last discovery file
 * names one.
 */
const DEFAULT_PORT = 3000;

/**
 * The waits before the second, third and fourth reconnect try, in ms. With the try at the close
 * the tries land 0, 1, 3 and 7 s after it, like the link's. The bin's restart keeps its port
 * closed for up to about 6 s (D-57: 500 ms for the socket closes, 500 ms for the stop and 5 s for
 * Bun's bundler), so the last try finds it open again. The grace of the door tools (`GRACE_MS`
 * in door-tools.ts) outlasts that try.
 */
export const RECONNECT_WAITS_MS: readonly number[] = [1000, 2000, 4000];

/**
 * How long a connection has to stay open to count as back, in ms. One the hub drops sooner counts
 * as a failed reconnect try: the next try waits (`RECONNECT_WAITS_MS`), and the tries still end
 * after the last wait. So a bin that accepts every socket and drops it at once is tried at most
 * four times in 7 s, not in a loop. The old server of a restarting bin can accept a socket too,
 * and drops it when it stops, at most about 1 s later (D-57).
 */
export const STABLE_MS = 5000;

/**
 * What a tool answers while no bin runs.
 */
export const NOT_RUNNING =
  "moku-editor is not running. Start it (`bunx moku-editor web/index.html --port 3000`) or call moku_start.";

/**
 * The stderr warning of reconnect tries that ended without a connection; the last failure follows
 * it.
 */
const NO_RECONNECT =
  "[moku-editor] mcp: could not reconnect to moku-editor; the next tool call tries again.";

/**
 * Opens a hub connection (the seam of the tests).
 */
export type ConnectHub = (bin: EditorDiscovery, options: HubClientOptions) => Promise<HubClient>;

/**
 * What the bin side needs: the root, the `mcp` arguments, the process seams and the callbacks of
 * an open and a lost connection.
 */
export type EditorLinkOptions = {
  /** The absolute project root. */
  readonly root: string;
  readonly args: McpArgs;
  readonly deps: Pick<BridgeDeps, "spawn" | "isAlive" | "command" | "now" | "ui">;
  /** Called with every new hub connection (the startup, a reconnect, a launch). */
  readonly onConnected: (client: HubClient) => void;
  /** Called when the open connection is gone: it closed, the owned bin stopped, or shutdown. */
  readonly onDisconnected: () => void;
  /** The hub connection factory (default `connectHub`). */
  readonly connect?: ConnectHub;
};

/**
 * The mutable state of the bin side.
 */
type LinkState = {
  client: HubClient | undefined;
  /** When the connection last opened (`deps.now`). */
  openedAt: number;
  /**
   * How many reconnect tries failed, or connected and were dropped within `STABLE_MS`, since a
   * connection last held: the index of the next wait in `RECONNECT_WAITS_MS`.
   */
  failedTries: number;
  owned: { readonly child: ChildProcess; readonly bin: EditorDiscovery } | undefined;
  seen: EditorDiscovery | undefined;
  startup: Promise<void> | undefined;
  /** The reconnect try in flight, or the last one. */
  reconnect: Promise<void> | undefined;
  /** Runs between two reconnect tries. */
  retryTimer: ReturnType<typeof setTimeout> | undefined;
  launching: Promise<EditorStatus> | undefined;
  launchAbort: AbortController | undefined;
  closing: boolean;
  lastError: string | undefined;
};

/**
 * The domain context of the bin side.
 */
type LinkCtx = EditorLinkOptions & { readonly state: LinkState; readonly connect: ConnectHub };

/**
 * The message of any thrown value.
 *
 * @param error - The thrown value.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("x")); // "x"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The error a tool gets while no bin runs, with the reason of the last failed start.
 *
 * @param lastError - The last start or connect failure, if any.
 * @returns The error.
 * @example
 * ```ts
 * throw notRunning(undefined);
 * ```
 */
export function notRunning(lastError: string | undefined): Error {
  const reason = lastError === undefined ? "" : `\n  Last attempt: ${lastError}`;
  return new Error(`[moku-editor] ${NOT_RUNNING}${reason}`);
}

/**
 * Remembers a failure for the next "not running" answer and prints it on stderr.
 *
 * @param ctx - The bin side.
 * @param error - The failure.
 */
function noteFailure(ctx: LinkCtx, error: unknown): void {
  ctx.state.lastError = messageOf(error);
  ctx.deps.ui.warn(ctx.state.lastError);
}

/**
 * The status now.
 *
 * @param state - The bin side state.
 * @returns Running, owned and the bin.
 */
function statusOf(state: LinkState): EditorStatus {
  const client = state.client?.isOpen() === true ? state.client : undefined;
  const bin = client?.bin ?? state.owned?.bin;
  return { running: client !== undefined, owned: state.owned !== undefined, bin };
}

/**
 * Stops the wait for the next reconnect try, if one runs.
 *
 * @param state - The bin side state.
 */
function stopRetry(state: LinkState): void {
  clearTimeout(state.retryTimer);
  state.retryTimer = undefined;
}

/**
 * The reconnect tries ended without a connection: one stderr warning with the last failure. From
 * here on only a tool call connects.
 *
 * @param ctx - The bin side.
 * @param failure - The message of the last failed try.
 */
function warnNoReconnect(ctx: LinkCtx, failure: string): void {
  ctx.deps.ui.warn(`${NO_RECONNECT}\n  Last attempt: ${failure}`);
}

/**
 * One reconnect try: connects to the live bin of the discovery file. A failed try plans the next
 * one (`retryLater`).
 *
 * @param ctx - The bin side.
 * @param live - The live discovery record, read right before.
 */
function tryReconnect(ctx: LinkCtx, live: EditorDiscovery): void {
  ctx.state.reconnect = connectTo(ctx, live).then(noop, (error: unknown) => {
    retryLater(ctx, error);
  });
}

/**
 * A reconnect try failed, or the hub dropped its connection within `STABLE_MS`: the failure is
 * remembered for the "not running" answer and printed nowhere, and the next try runs after its
 * wait (`RECONNECT_WAITS_MS`), once the discovery file was read again. The tries end with a
 * connection (of a try or of a tool call), on shutdown, and with one warning after the last wait
 * or when the bin is gone at a try. One wait runs at most, and none while a connection is open.
 *
 * @param ctx - The bin side.
 * @param error - The failure.
 */
function retryLater(ctx: LinkCtx, error: unknown): void {
  const { state } = ctx;
  const failure = messageOf(error);
  state.lastError = failure;
  // Nothing is planned on shutdown, while a connection is open, or next to a wait that runs.
  if (state.closing || state.client?.isOpen() === true || state.retryTimer !== undefined) return;

  const wait = RECONNECT_WAITS_MS[state.failedTries];
  if (wait === undefined) {
    warnNoReconnect(ctx, failure);
    return;
  }

  state.failedTries += 1;
  state.retryTimer = setTimeout(() => {
    state.retryTimer = undefined;
    const { live } = findEditor(ctx.root, ctx.deps.isAlive);
    if (live === undefined) warnNoReconnect(ctx, failure);
    else tryReconnect(ctx, live);
  }, wait);
}

/**
 * The connection closed without the bridge closing it: the door tools hear it, one stderr line
 * says what follows, then the bridge reconnects while the discovery file names a live bin. A
 * connection that held (`STABLE_MS`) starts the tries over, with one at once. One the hub dropped
 * sooner counts as a failed try (`retryLater`). A bin that is gone gets no try: the tools answer
 * "not running".
 *
 * @param ctx - The bin side.
 * @param bin - The bin the lost connection talked to.
 */
function onLost(ctx: LinkCtx, bin: EditorDiscovery): void {
  const { state, deps } = ctx;
  const held = deps.now() - state.openedAt >= STABLE_MS;
  state.client = undefined;
  ctx.onDisconnected();
  if (state.closing) return;

  const { live } = findEditor(ctx.root, deps.isAlive);
  if (live === undefined) {
    deps.ui.info("moku-editor mcp: the moku-editor connection closed; no running moku-editor");
    return;
  }
  if (held) {
    deps.ui.info("moku-editor mcp: the moku-editor connection closed; reconnecting");
    state.failedTries = 0;
    tryReconnect(ctx, live);
    return;
  }

  const early = `less than ${String(STABLE_MS / 1000)} s`;
  deps.ui.info(`moku-editor mcp: the moku-editor connection closed after ${early}`);
  retryLater(
    ctx,
    new Error(`[moku-editor] moku-editor at ${bin.url} closed the connection after ${early}.`)
  );
}

/**
 * Connects to a live bin and hands the open client to `onConnected` (the door tools follow its
 * sessions). The reconnect tries end here. When a reconnect try and a tool call connect at once,
 * the first connection stays and the second one is closed. A connection that opens after
 * shutdown began is closed and never reported.
 *
 * @param ctx - The bin side.
 * @param bin - The live discovery record.
 * @returns The open client; a closed one when shutdown began meanwhile.
 */
async function connectTo(ctx: LinkCtx, bin: EditorDiscovery): Promise<HubClient> {
  const { state } = ctx;
  const client: HubClient = await ctx.connect(bin, {
    onClose: () => {
      if (state.client === client) onLost(ctx, bin);
    }
  });
  // Shutdown began while the connect was in flight: nothing follows this connection.
  if (state.closing) {
    client.close();
    return client;
  }
  const first = state.client;
  if (first?.isOpen() === true) {
    client.close();
    return first;
  }

  stopRetry(state);
  state.client = client;
  state.openedAt = ctx.deps.now();
  state.seen = bin;
  state.lastError = undefined;
  ctx.onConnected(client);
  ctx.deps.ui.info(`moku-editor mcp: connected to ${bin.url}`);
  return client;
}

/**
 * Starts the bin when none runs, then connects. A live bin found first is used instead.
 *
 * @param ctx - The bin side.
 * @param input - The html and port asked for, if any.
 * @param input.html - The game HTML file.
 * @param input.port - The port.
 * @returns The status after the start.
 * @throws {Error} When no html is known, or the start fails.
 */
async function launchNow(
  ctx: LinkCtx,
  input: { readonly html?: string; readonly port?: number }
): Promise<EditorStatus> {
  const { state, args, deps, root } = ctx;
  // Already connected: nothing to start.
  if (state.client?.isOpen() === true) return statusOf(state);

  // A bin that came up meanwhile is used instead of a second one.
  const found = findEditor(root, deps.isAlive);
  state.seen = found.seen ?? state.seen;
  if (found.live !== undefined) {
    await connectTo(ctx, found.live);
    return statusOf(state);
  }

  // The html and port: the call's, else argv's, else the last discovery file's.
  const html = input.html ?? args.html ?? state.seen?.html;
  if (html === undefined) {
    throw new Error(
      "[moku-editor] moku_start needs the game HTML file.\n  Pass html, such as web/index.html."
    );
  }
  const port = input.port ?? args.port ?? state.seen?.port ?? DEFAULT_PORT;

  // Start the bin; shutdown can abort the start through the controller.
  const controller = new AbortController();
  state.launchAbort = controller;
  const options = { html: resolve(html), port, root, hmr: args.hmr };
  const { child, bin } = await launchEditor(options, { ...deps, signal: controller.signal });

  // The bin is ours until its process exits; then connect, unless shutdown began.
  state.owned = { child, bin };
  child.exited.then(() => {
    if (state.owned?.child === child) state.owned = undefined;
  }, noop);
  deps.ui.info(`moku-editor mcp: started moku-editor on ${bin.url} (log .moku/editor.log)`);
  if (!state.closing) await connectTo(ctx, bin);
  return statusOf(state);
}

/**
 * Runs one launch at a time: a second call while one runs gets the same promise.
 *
 * @param ctx - The bin side.
 * @param input - The html and port asked for.
 * @param input.html - The game HTML file.
 * @param input.port - The port.
 * @returns The status after the start.
 */
function launchOnce(
  ctx: LinkCtx,
  input: { readonly html?: string; readonly port?: number }
): Promise<EditorStatus> {
  const { state } = ctx;
  state.launching ??= launchNow(ctx, input).finally(() => {
    state.launching = undefined;
    state.launchAbort = undefined;
  });
  return state.launching;
}

/**
 * Warns when `--port` names another port than the running bin's: the flag only applies to a bin
 * the bridge starts.
 *
 * @param ctx - The bin side.
 * @param port - The port the running bin listens on.
 */
function warnOnPortMismatch(ctx: LinkCtx, port: number): void {
  const asked = ctx.args.port;
  if (asked === undefined || asked === port) return;

  ctx.deps.ui.warn(
    `[moku-editor] mcp: the running moku-editor listens on port ${String(port)}; --port ${String(asked)} only applies when the bridge starts it`
  );
}

/**
 * The startup: a live bin is connected (a different `--port` prints one line); otherwise the bin
 * is started when an html is known. Failures are remembered, never thrown.
 *
 * @param ctx - The bin side.
 */
async function startup(ctx: LinkCtx): Promise<void> {
  const { state, args, deps, root } = ctx;
  const found = findEditor(root, deps.isAlive);
  state.seen = found.seen;

  if (found.live !== undefined) {
    warnOnPortMismatch(ctx, found.live.port);
    await connectTo(ctx, found.live).catch((error: unknown) => noteFailure(ctx, error));
    return;
  }

  if (args.html === undefined && found.seen === undefined) {
    deps.ui.info(
      "moku-editor mcp: no running moku-editor and no game html; waiting for moku_start"
    );
    return;
  }
  await launchOnce(ctx, {}).catch((error: unknown) => noteFailure(ctx, error));
}

/**
 * The open client, after the startup and a reconnect try in flight settled; else one connect to a
 * live bin (a tool call does not wait for the next try).
 *
 * @param ctx - The bin side.
 * @returns The open client.
 * @throws {Error} "moku-editor is not running…" when no live bin is found.
 */
async function hubOf(ctx: LinkCtx): Promise<HubClient> {
  const { state } = ctx;
  await state.startup;
  await state.reconnect;
  await state.launching?.catch(noop);
  if (state.client?.isOpen() === true) return state.client;

  const found = findEditor(ctx.root, ctx.deps.isAlive);
  state.seen = found.seen ?? state.seen;
  if (found.live === undefined) throw notRunning(state.lastError);
  return connectTo(ctx, found.live);
}

/**
 * Stops the bin this bridge started; a bin it did not start is left alone.
 *
 * @param ctx - The bin side.
 * @returns Whether a bin was stopped, and the status after.
 */
async function stopOwnedBin(
  ctx: LinkCtx
): Promise<{ readonly stopped: boolean; readonly status: EditorStatus }> {
  const { state } = ctx;
  await state.launching?.catch(noop);
  const { owned } = state;
  if (owned === undefined) return { stopped: false, status: statusOf(state) };

  // Nothing reconnects to a bin the bridge stops.
  stopRetry(state);
  if (state.client?.bin.pid === owned.bin.pid) {
    state.client.close();
    state.client = undefined;
    ctx.onDisconnected();
  }
  state.owned = undefined;
  await stopChild(owned.child);
  ctx.deps.ui.info(`moku-editor mcp: stopped moku-editor (pid ${String(owned.bin.pid)})`);
  return { stopped: true, status: statusOf(state) };
}

/**
 * The stdin end: ends the reconnect tries, cancels a start in progress, closes the connection and
 * stops an owned bin.
 *
 * @param ctx - The bin side.
 */
async function shutdown(ctx: LinkCtx): Promise<void> {
  const { state } = ctx;
  state.closing = true;
  stopRetry(state);
  state.launchAbort?.abort();
  await Promise.allSettled([state.startup, state.reconnect, state.launching]);

  const { client, owned } = state;
  state.client = undefined;
  if (client !== undefined) {
    client.close();
    ctx.onDisconnected();
  }
  state.owned = undefined;
  if (owned !== undefined) await stopChild(owned.child);
}

/**
 * Does nothing (a rejection already handled where it happened).
 */
function noop(): void {
  // Handled elsewhere.
}

/**
 * Creates the bin side of the bridge.
 *
 * @param options - Root, `mcp` arguments, process seams and the connection callbacks.
 * @returns The EditorLink the tools use.
 * @example
 * ```ts
 * const editor = createEditorLink({
 *   root,
 *   args,
 *   deps,
 *   onConnected: client => doors.follow(client),
 *   onDisconnected: () => doors.unfollow()
 * });
 * void editor.start();
 * const hub = await editor.hub(); // throws "moku-editor is not running…" when no bin runs
 * ```
 */
export function createEditorLink(options: EditorLinkOptions): EditorLink {
  const ctx: LinkCtx = {
    ...options,
    connect: options.connect ?? connectHub,
    state: {
      client: undefined,
      openedAt: 0,
      failedTries: 0,
      owned: undefined,
      seen: undefined,
      startup: undefined,
      reconnect: undefined,
      retryTimer: undefined,
      launching: undefined,
      launchAbort: undefined,
      closing: false,
      lastError: undefined
    }
  };

  return {
    start: () => {
      ctx.state.startup ??= startup(ctx);
      return ctx.state.startup;
    },
    hub: () => hubOf(ctx),
    connected: () => (ctx.state.client?.isOpen() === true ? ctx.state.client : undefined),
    status: () => statusOf(ctx.state),
    launch: async input => {
      await ctx.state.startup;
      return launchOnce(ctx, input);
    },
    stopOwned: () => stopOwnedBin(ctx),
    shutdown: () => shutdown(ctx)
  };
}
