/**
 * @file pages/mcp — the bin side of the bridge (M3): a live `.moku/editor.json` under the root
 * wins; without one the bridge starts the bin when it knows the game html (argv or the last
 * discovery file it saw). A hub socket that closes is re-read and reconnected once. The bridge
 * stops only a bin it started.
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
 * What a tool answers while no bin runs.
 */
export const NOT_RUNNING =
  "moku-editor is not running. Start it (`bunx moku-editor web/index.html --port 3000`) or call moku_start.";

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
  owned: { readonly child: ChildProcess; readonly bin: EditorDiscovery } | undefined;
  seen: EditorDiscovery | undefined;
  startup: Promise<void> | undefined;
  reconnect: Promise<void> | undefined;
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
 * The connection closed without the bridge closing it: re-read the discovery file and reconnect
 * once. A bin that is gone leaves the tools answering "not running".
 *
 * @param ctx - The bin side.
 */
function onLost(ctx: LinkCtx): void {
  const { state } = ctx;
  state.client = undefined;
  ctx.onDisconnected();
  if (state.closing) return;

  ctx.deps.ui.warn("[moku-editor] mcp: the moku-editor connection closed; reconnecting once");
  const { live } = findEditor(ctx.root, ctx.deps.isAlive);
  if (live === undefined) return;
  state.reconnect = connectTo(ctx, live).then(noop, (error: unknown) => noteFailure(ctx, error));
}

/**
 * Connects to a live bin and hands the open client to `onConnected` (the door tools follow its
 * sessions).
 *
 * @param ctx - The bin side.
 * @param bin - The live discovery record.
 * @returns The open client.
 */
async function connectTo(ctx: LinkCtx, bin: EditorDiscovery): Promise<HubClient> {
  const { state } = ctx;
  const client: HubClient = await ctx.connect(bin, {
    onClose: () => {
      if (state.client === client) onLost(ctx);
    }
  });
  state.client = client;
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
 * The open client, after the startup and a reconnect settled; else one connect to a live bin.
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
 * The stdin end: cancels a start in progress, closes the connection and stops an owned bin.
 *
 * @param ctx - The bin side.
 */
async function shutdown(ctx: LinkCtx): Promise<void> {
  const { state } = ctx;
  state.closing = true;
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
      owned: undefined,
      seen: undefined,
      startup: undefined,
      reconnect: undefined,
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
