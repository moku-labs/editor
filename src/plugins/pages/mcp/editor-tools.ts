/**
 * @file pages/mcp — the editor tools (M5, D-60, D-62): moku_reload (`editor.reload`, then the game
 * coming back), moku_device and moku_show (`editor.device` and `editor.show`, which the hub relays
 * to the editor page; `askPage` is the one way the bridge asks that page), moku_hot_reload (`POST
 * P/hmr` with the token of the discovery file, then the bin coming back from its restart),
 * moku_start (the launcher when no bin runs) and moku_stop (only a bin this bridge started). The
 * token goes only into the Authorization header of that POST: never into a result or onto stderr.
 */
import type { HotReload, Json, RelayedEditorMethod } from "../../registry/protocol";
import {
  errorCode,
  isWireError,
  parseDeviceInfo,
  parseShowInfo,
  WORKSPACE_NAMES
} from "../../registry/protocol";
import type { EditorDiscovery } from "../types";
import { toolsUrl } from "./game-tools";
import { pollFor, replayed } from "./poll";
import { errorResult, jsonResult } from "./results";
import { flagArgument, optionalNumberArgument, SESSION_PROPERTY, textArgument } from "./schema";
import { chooseSession } from "./sessions";
import { readHotReload, restoredFrameOf } from "./shapes";
import type {
  EditorStatus,
  HubClient,
  JsonObject,
  SessionView,
  Tool,
  ToolAnnotations,
  ToolCall,
  ToolContext,
  ToolResult
} from "./types";

/**
 * How long moku_reload waits for the game to connect again.
 */
const RELOAD_WAIT_MS = 15_000;

/**
 * How long moku_hot_reload waits for the bin to come back from its restart with the asked state.
 * The restart keeps the port closed for up to about 6 s (D-57), and the bridge's last reconnect
 * try lands 7 s after the close.
 */
const SWITCH_WAIT_MS = 15_000;

/**
 * How often moku_hot_reload looks at the connection while it waits, in ms.
 */
const SWITCH_POLL_MS = 100;

/**
 * How long a connection opened after the switch has to stay open to count as the bin being back,
 * in ms. The old server of the restarting bin can still take the bridge's first reconnect try, and
 * drops that socket when it stops, at most about 1 s later (D-57: 500 ms for the socket closes and
 * 500 ms for the stop). A tool call right after such a connection would find the port closed.
 */
const SWITCH_SETTLE_MS = 1500;

/**
 * How long the POST of moku_hot_reload may take, in ms. The bin answers before it restarts.
 */
const POST_TIMEOUT_MS = 5000;

/**
 * The HTTP status of an accepted `P/hmr` POST.
 */
const HTTP_OK = 200;

/**
 * What a tool answers when the editor page does not know an editor request: a page loaded before
 * the bin was updated.
 */
const PAGE_OLDER = "[moku-editor] this editor page is older than the bridge; reload it";

/**
 * What moku_hot_reload answers for a game's own server: only the moku-editor bin can restart with
 * Bun HMR flipped.
 */
const OWNED_BY_SERVER = "hot reload is owned by the game's server; it cannot be switched";

/**
 * The annotations of a tool that changes the editor, destroys nothing and can be repeated.
 */
const REPEATABLE: ToolAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false
};

/**
 * What the `P/hmr` POST came to: the state the bin answered, the status of a refusal, or no answer
 * (the restart cut it, or the body was not a state). No answer counts as sent.
 */
type HmrAnswer =
  | { readonly kind: "answered"; readonly state: HotReload }
  | { readonly kind: "refused"; readonly status: number }
  | { readonly kind: "unanswered" };

/**
 * Asks the editor page through the hub (D-60): sends an editor request the hub relays to the page
 * and reads the answer with the protocol parser of the method. Hub errors pass through, such as
 * -32003 `no_editor_page` with the URL to open and the page's -32602.
 *
 * @param hub - The hub connection.
 * @param method - The relayed editor method: "device", "show", "node" or "select".
 * @param params - The checked params.
 * @param parse - The protocol parser of the answer.
 * @returns The checked answer.
 * @throws {Error} "this editor page is older than the bridge; reload it" for a -32601 (the page
 *   has no handler for the method), `editor.<method> answered an unexpected value.` for an answer
 *   the parser refuses.
 * @example
 * ```ts
 * const device = await askPage(hub, "device", { orientation: "landscape" }, parseDeviceInfo);
 * device.w; // 915: the game viewport after the change
 * ```
 */
export async function askPage<T>(
  hub: HubClient,
  method: RelayedEditorMethod,
  params: JsonObject,
  parse: (value: unknown) => T | undefined
): Promise<T> {
  let answer: Json;
  try {
    answer = await hub.request("editor", method, params);
  } catch (error) {
    if (isWireError(error) && error.code === errorCode.unknownMethod) throw new Error(PAGE_OLDER);
    throw error;
  }

  const info = parse(answer);
  if (info === undefined) {
    throw new Error(`[moku-editor] editor.${method} answered an unexpected value.`);
  }
  return info;
}

/**
 * True for the -32001 `game_reloaded` a run gets when the page reloads before it answered: the
 * expected end of editor.reload.
 *
 * @param error - The thrown value.
 * @returns Whether the page reloaded under the call.
 * @example
 * ```ts
 * isGameReloaded(wireError(-32_001, "game reloaded", { reason: "game_reloaded" })); // true
 * ```
 */
function isGameReloaded(error: unknown): boolean {
  return (
    isWireError(error) &&
    (error.code === errorCode.gameReloaded || error.data?.reason === "game_reloaded")
  );
}

/**
 * Waits for a `sessions` list with a session that was not there before (the same game when it
 * is known).
 *
 * @param hub - The hub connection.
 * @param before - The session ids before the reload, and the game.
 * @param before.known - The ids before the reload.
 * @param before.game - The game of the reloaded session, if known.
 * @param signal - Ends the wait early (a cancelled request).
 * @returns The new session, or undefined after RELOAD_WAIT_MS.
 */
function waitForReturn(
  hub: HubClient,
  before: { readonly known: ReadonlySet<string>; readonly game: string | undefined },
  signal: AbortSignal
): Promise<SessionView | undefined> {
  const isBack = (session: SessionView): boolean =>
    !before.known.has(session.id) && (before.game === undefined || session.game === before.game);

  return new Promise(resolve => {
    const done = (session?: SessionView): void => {
      off();
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(session);
    };
    const onAbort = (): void => done();
    const off = hub.onSessions(list => {
      const back = list.find(session => isBack(session));
      if (back !== undefined) done(back);
    });
    const timer = setTimeout(() => done(), RELOAD_WAIT_MS);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * moku_reload: runs editor.reload (a -32001 on that run is expected), waits for the game to
 * connect again and reads whether it restored its checkpoint.
 *
 * @param call - The call: restore, session.
 * @param context - The tool context.
 * @returns `{ restored, frame, session }`.
 */
async function reload(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  const session = textArgument(call.args, "session");
  const restore = flagArgument(call.args, "restore", true);
  const sessions = hub.sessions();
  const before = {
    known: new Set(sessions.map(entry => entry.id)),
    game: chooseSession(sessions, session)?.game
  };

  const controller = new AbortController();
  const stopWaiting = (): void => controller.abort();
  call.signal.addEventListener("abort", stopWaiting, { once: true });
  const back = waitForReturn(hub, before, controller.signal);
  try {
    await hub.request("game", "run", { id: "editor.reload", input: { restore } }, session);
  } catch (error) {
    if (!isGameReloaded(error)) {
      controller.abort();
      throw error;
    }
  }

  const next = await back;
  call.signal.removeEventListener("abort", stopWaiting);
  if (next === undefined) {
    return errorResult(
      `the game did not connect again within ${String(RELOAD_WAIT_MS / 1000)} s after the reload`
    );
  }
  const frame = restoredFrameOf(await hub.request("game", "manifest", {}, next.id));
  return jsonResult({ restored: frame !== undefined, frame, session: next.id, game: next.game });
}

/**
 * moku_device: the given fields change the device of the tools page; none only reads it.
 *
 * @param call - The call: preset, orientation, folded.
 * @param context - The tool context.
 * @returns The DeviceInfo as JSON.
 */
async function device(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  return jsonResult(await askPage(hub, "device", call.args, parseDeviceInfo));
}

/**
 * moku_show: activates a workspace of the tools page; without one it only reads the active one.
 *
 * @param call - The call: workspace.
 * @param context - The tool context.
 * @returns `{ workspace, workspaces }`.
 */
async function show(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const hub = await context.editor.hub();
  return jsonResult(await askPage(hub, "show", call.args, parseShowInfo));
}

/**
 * "on" or "off".
 *
 * @param hmr - Bun HMR on or off.
 * @returns The word.
 * @example
 * ```ts
 * wordOf(false); // "off"
 * ```
 */
function wordOf(hmr: boolean): string {
  return hmr ? "on" : "off";
}

/**
 * Sends `POST <tools page>hmr` with `{ hmr }` and the token of the discovery file as a Bearer
 * (the contract of `pages/hot-reload.ts`). A redirect is not followed. Nothing of the request is
 * printed: a failure reads as no answer.
 *
 * @param bin - The discovery record: the URL and the token.
 * @param on - The asked value.
 * @param signal - Aborted when the call is cancelled.
 * @returns The state of a 200, the status of another answer, or no answer when the network failed
 *   (the bin's restart closes the connection) or the body is not a state.
 */
async function postHmr(bin: EditorDiscovery, on: boolean, signal: AbortSignal): Promise<HmrAnswer> {
  try {
    const response = await fetch(`${toolsUrl(bin)}hmr`, {
      method: "POST",
      redirect: "manual",
      headers: { authorization: `Bearer ${bin.token}`, "content-type": "application/json" },
      body: JSON.stringify({ hmr: on }),
      signal: AbortSignal.any([signal, AbortSignal.timeout(POST_TIMEOUT_MS)])
    });
    if (response.status !== HTTP_OK) return { kind: "refused", status: response.status };

    const body: Json = JSON.parse(await response.text());
    const state = readHotReload(body);
    return state === undefined ? { kind: "unanswered" } : { kind: "answered", state };
  } catch {
    return { kind: "unanswered" };
  }
}

/**
 * Why the POST did not start a switch, or undefined when the bin took it (or its answer was cut).
 *
 * @param answer - What the POST came to.
 * @param on - The asked value.
 * @returns The message of the `isError` result, or undefined.
 * @example
 * ```ts
 * refusalOf({ kind: "refused", status: 401 }, false); // "moku-editor answered HTTP 401 to the hot reload switch"
 * refusalOf({ kind: "answered", state: { hmr: false, owner: "bin" } }, false); // undefined
 * ```
 */
function refusalOf(answer: HmrAnswer, on: boolean): string | undefined {
  if (answer.kind === "refused") {
    return `moku-editor answered HTTP ${String(answer.status)} to the hot reload switch`;
  }
  if (answer.kind === "unanswered") return undefined;
  if (answer.state.owner === "server") return OWNED_BY_SERVER;
  // A bin attached without its restart keeps its state and says so with a 200.
  return answer.state.hmr === on
    ? undefined
    : `moku-editor did not switch hot reload: it stays ${wordOf(answer.state.hmr)}`;
}

/**
 * The hot reload state of a connection opened after the switch, once it carries the asked value.
 * The connection of the POST does not count: the hub published the asked state on it before the
 * restart closed it.
 *
 * @param current - The open connection now, if any.
 * @param before - The connection the switch was asked on.
 * @param on - The asked value.
 * @returns The state, or undefined while the bin is not back.
 */
function switchedState(
  current: HubClient | undefined,
  before: HubClient,
  on: boolean
): HotReload | undefined {
  if (current === undefined || current === before) return undefined;
  const state = readHotReload(current.hotReload());
  return state?.hmr === on ? state : undefined;
}

/**
 * The reading moku_hot_reload polls: the hot reload state once the bin is back. That is a
 * connection opened after the switch, carrying the asked value, that stayed the open one for
 * `SWITCH_SETTLE_MS`. A connection that is gone or replaced starts the count again.
 *
 * @param context - The tool context: the bin side and the clock.
 * @param before - The connection the switch was asked on.
 * @param on - The asked value.
 * @returns The reading: the state, or undefined while the bin is not back.
 */
function switchWatch(
  context: ToolContext,
  before: HubClient,
  on: boolean
): () => HotReload | undefined {
  let held: HubClient | undefined;
  let since = 0;

  return (): HotReload | undefined => {
    const current = context.editor.connected();
    const state = switchedState(current, before, on);
    if (state === undefined || current !== held) {
      held = state === undefined ? undefined : current;
      since = context.now();
      return undefined;
    }
    return context.now() - since >= SWITCH_SETTLE_MS ? state : undefined;
  };
}

/**
 * moku_hot_reload: switches Bun HMR of the bin. Already in the asked state answers at once, with
 * no POST; a game's own server is refused. Otherwise the POST goes out, the bin restarts its
 * server (D-32), and the call waits at most 15 s until the bridge is connected again, the hub
 * replayed the asked state and that connection held (`switchWatch`). It only looks at the
 * connection (`editor.connected()`): the bin side reconnects by itself, and a connect of its own
 * would throw while the port is closed.
 *
 * @param call - The call: on.
 * @param context - The tool context.
 * @returns `{ hmr, owner, restarted }`, or isError for a refusal or a bin that did not come back.
 */
async function hotReload(call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const on = flagArgument(call.args, "on", true);
  const hub = await context.editor.hub();

  // What the bin serves with now; a call that just connected waits a moment for the hub's replay.
  const kept = await replayed(() => readHotReload(hub.hotReload()));
  if (kept?.owner === "server") return errorResult(OWNED_BY_SERVER);
  if (kept?.hmr === on) return jsonResult({ ...kept, restarted: false });

  // The switch: the bin answers, then restarts; an answer the restart cut off counts as sent.
  const refusal = refusalOf(await postHmr(hub.bin, on, call.signal), on);
  if (refusal !== undefined) return errorResult(refusal);

  // The restart closes this connection: the next one that holds carries the asked state.
  const startedAt = context.now();
  const isOver = (): boolean => call.signal.aborted || context.now() - startedAt >= SWITCH_WAIT_MS;
  const state = await pollFor(switchWatch(context, hub, on), isOver, SWITCH_POLL_MS);
  if (state === undefined) {
    return errorResult(
      `moku-editor did not come back with hot reload ${wordOf(on)} within ${String(SWITCH_WAIT_MS / 1000)} s; call moku_status`
    );
  }
  return jsonResult({ ...state, restarted: true });
}

/**
 * The JSON of a bin status.
 *
 * @param status - The status.
 * @returns `{ running, owned, url, pid }`.
 * @example
 * ```ts
 * statusJson(context.editor.status()); // { running: true, owned: true, url: "http://127.0.0.1:3000/", pid: 4242 }
 * ```
 */
function statusJson(status: EditorStatus): {
  [key: string]: string | number | boolean | undefined;
} {
  const { running, owned, bin } = status;
  return { running, owned, url: bin === undefined ? undefined : `${bin.url}/`, pid: bin?.pid };
}

/**
 * moku_stop: stops the bin this bridge started; a bin started elsewhere is refused.
 *
 * @param _call - The call (no arguments).
 * @param context - The tool context.
 * @returns `{ stopped, running }`, or isError for a bin this bridge did not start.
 */
async function stop(_call: ToolCall, context: ToolContext): Promise<ToolResult> {
  const { stopped, status } = await context.editor.stopOwned();
  if (stopped) return jsonResult({ stopped: true, running: status.running });

  let running: EditorDiscovery;
  try {
    const hub = await context.editor.hub();
    running = hub.bin;
  } catch {
    return jsonResult({ stopped: false, running: false });
  }
  return errorResult(
    `moku-editor (pid ${String(running.pid)}) was not started by this bridge; stop it where it runs (Ctrl+C)`
  );
}

/**
 * moku_reload.
 */
export const reloadTool: Tool = {
  name: "moku_reload",
  title: "Reload the game",
  description:
    "Reloads the game page. With restore (the default) it keeps the game state: a checkpoint is taken before the reload and restored after it. Answers { restored, frame, session } once the game is back.",
  inputSchema: {
    type: "object",
    properties: {
      restore: {
        type: "boolean",
        default: true,
        description: "Keep the game state across the reload."
      },
      session: SESSION_PROPERTY
    },
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: false
  },
  run: reload
};

/**
 * moku_device: lets an MCP client read and set the device of the tools page (preset, orientation,
 * fold), the way the device bar of the Game workspace does. The answer carries the game viewport
 * after the change and the presets to choose from.
 */
export const deviceTool: Tool = {
  name: "moku_device",
  title: "Editor device",
  description:
    "The device the tools page shows the game in. Each argument is optional and only the given ones change: preset (an id from presets), orientation, and folded for a foldable. With no argument it only reads. Answers { preset, orientation, folded, w, h, presets }: w and h are the game viewport in CSS px after the change, presets the devices to choose from. Take moku_screenshot after it to see the new size. Needs the tools page open: without it the answer names the URL to open.",
  inputSchema: {
    type: "object",
    properties: {
      preset: {
        type: "string",
        minLength: 1,
        description: "A device preset id from presets, such as pixel-8 or ipad-mini."
      },
      orientation: {
        type: "string",
        enum: ["portrait", "landscape"],
        description: "How the device is held."
      },
      folded: {
        type: "boolean",
        description: "A foldable preset: true shows its cover screen, false its inner screen."
      }
    },
    additionalProperties: false
  },
  annotations: REPEATABLE,
  run: device
};

/**
 * moku_show: lets an MCP client switch the workspace of the tools page, the way a click on the
 * rail does, or read which one is active.
 */
export const showTool: Tool = {
  name: "moku_show",
  title: "Show a workspace",
  description:
    "Switches the tools page to a workspace of its rail: flow (the flow graph), game (the game and its device), render, state, files or console. With no argument it only reads. Answers { workspace, workspaces }: the active workspace and all of them. Needs the tools page open: without it the answer names the URL to open.",
  inputSchema: {
    type: "object",
    properties: {
      workspace: {
        type: "string",
        enum: WORKSPACE_NAMES,
        description: "The workspace to show."
      }
    },
    additionalProperties: false
  },
  annotations: REPEATABLE,
  run: show
};

/**
 * moku_hot_reload: lets an MCP client switch Bun hot reload of the game server on or off. The bin
 * restarts its server for it, so the call returns once the bridge is connected again.
 */
export const hotReloadTool: Tool = {
  name: "moku_hot_reload",
  title: "Switch hot reload",
  description:
    "Switches Bun hot reload of the game server on or off. moku-editor restarts its server for it: the call waits, at most 15 s, until the editor is back, and answers { hmr, owner, restarted }. Already in the asked state answers restarted: false at once. After a switch the game page has to load again to pick it up: call moku_reload. A game served by its own server cannot be switched. moku_status shows the state.",
  inputSchema: {
    type: "object",
    properties: {
      on: {
        type: "boolean",
        description: "true: a saved source file reloads the game page. false: it does not."
      }
    },
    required: ["on"],
    additionalProperties: false
  },
  annotations: REPEATABLE,
  run: hotReload
};

/**
 * moku_start.
 */
export const startTool: Tool = {
  name: "moku_start",
  title: "Start the editor",
  description:
    "Starts moku-editor for the game when it does not run (its output goes to .moku/editor.log) and connects. html defaults to the bridge's game file or the last one used; in a moku-game folder (index.ts and config.ts) no html is needed: the engine page starts. port defaults to the bridge's --port, the last port or 3000.",
  inputSchema: {
    type: "object",
    properties: {
      html: {
        type: "string",
        minLength: 1,
        description: "The game HTML file, such as web/index.html."
      },
      port: {
        type: "integer",
        minimum: 0,
        maximum: 65_535,
        description: "The port on 127.0.0.1 (0 picks a free one)."
      }
    },
    additionalProperties: false
  },
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false
  },
  run: async (call, context) => {
    const html = textArgument(call.args, "html");
    const port = optionalNumberArgument(call.args, "port");
    const input = {
      ...(html === undefined ? {} : { html }),
      ...(port === undefined ? {} : { port })
    };
    return jsonResult(statusJson(await context.editor.launch(input)));
  }
};

/**
 * moku_stop.
 */
export const stopTool: Tool = {
  name: "moku_stop",
  title: "Stop the editor",
  description:
    "Stops moku-editor when this bridge started it. A moku-editor started elsewhere keeps running.",
  inputSchema: { type: "object", properties: {}, additionalProperties: false },
  annotations: {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false
  },
  run: stop
};
