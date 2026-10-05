/**
 * @file pages/mcp — the editor lifecycle tools (M5): moku_reload (`editor.reload`, then the game
 * coming back), moku_start (the launcher when no bin runs) and moku_stop (only a bin this bridge
 * started).
 */
import { errorCode, isWireError } from "../../registry/protocol";
import type { EditorDiscovery } from "../types";
import { errorResult, jsonResult } from "./results";
import { flagArgument, optionalNumberArgument, SESSION_PROPERTY, textArgument } from "./schema";
import { chooseSession } from "./sessions";
import { restoredFrameOf } from "./shapes";
import type {
  EditorStatus,
  HubClient,
  SessionView,
  Tool,
  ToolCall,
  ToolContext,
  ToolResult
} from "./types";

/**
 * How long moku_reload waits for the game to connect again.
 */
const RELOAD_WAIT_MS = 15_000;

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
 * moku_start.
 */
export const startTool: Tool = {
  name: "moku_start",
  title: "Start the editor",
  description:
    "Starts moku-editor for the game when it does not run (its output goes to .moku/editor.log) and connects. html defaults to the bridge's game file or the last one used; port to the bridge's --port, the last port or 3000.",
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
