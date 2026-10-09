/**
 * @file pages plugin — the bin's game server (D-32, A9): one mutable current Bun server. The Hot
 * reload switch restarts it with new options on the same port: the hub closes every socket with
 * 1012 "editor restarting" (U11), then Bun's stop, bounded (it does not resolve while a close is in
 * flight), then, before a server with HMR, the wait for Bun's bundler to be idle, bounded (D-57:
 * a Bun 1.3.14 deadlock, see `waitForBundler`), then Bun.serve. Restarts and the final stop run
 * one after another and always reach the current server. The hub keeps running, so its token
 * stays.
 */
import type { BunServeOptions } from "../hub/types";
import { hmrOf } from "./hot-reload";
import type { AttachedServer } from "./types";

/**
 * How long a stop waits for Bun's server stop before it gives up.
 */
export const STOP_GRACE_MS = 500;

/**
 * How long a restart waits for Bun's bundler to be idle before it serves with HMR (D-57). A page
 * rebundle ends well within it (about 100 ms for a 10 MB page); after it the restart goes on.
 */
export const BUNDLER_IDLE_MS = 5000;

/**
 * Close code of every socket on a restart: 1012, service restart. Clients log it at info and
 * reconnect.
 */
export const SERVICE_RESTART = 1012;

/**
 * Close reason of every socket on a restart.
 */
const RESTARTING = "editor restarting";

/**
 * The entry of the empty build of `waitForBundler`: it lives in memory, never on disk.
 */
const IDLE_ENTRY = "/moku-editor-idle.js";

/**
 * How a warning about a given-up wait for Bun's bundler ends.
 */
const GOES_ON = "the server restarts without waiting for it";

/**
 * Closes every editor socket with a code and a reason, and resolves when they closed:
 * `hub.closeAll` in the bin.
 */
export type CloseSockets = (code: number, reason: string) => Promise<void>;

/**
 * Starts a server: Bun.serve in the bin, a fake in tests. Throws when the port is taken.
 */
export type StartServer = (options: BunServeOptions) => AttachedServer;

/**
 * Resolves once Bun's bundler finished the work it had: `waitForBundler` in the bin, a fake in
 * tests.
 */
export type BundlerIdle = () => Promise<void>;

/**
 * What the bin and the tests give the game server besides its sockets.
 *
 * @example
 * ```ts
 * // The bin: the real Bun.serve and bundler; a given-up wait goes to its console.
 * const seams: GameServerSeams = { warn: message => ui.warn(message) };
 * ```
 */
export type GameServerSeams = {
  /** Starts a server; default Bun.serve. */
  readonly serve?: StartServer;
  /** Waits until Bun's bundler is idle (D-57); default `waitForBundler`. */
  readonly bundlerIdle?: BundlerIdle;
  /** Hears once why a wait for Bun's bundler was given up; default nothing. */
  readonly warn?: (message: string) => void;
};

/**
 * The bin's game server: the current Bun server, its restart and its stop.
 *
 * @example
 * ```ts
 * const game = createGameServer(editor.hub.serve({ port: 0, routes }), (code, reason) =>
 *   editor.hub.closeAll(code, reason)
 * );
 * editor.pages.attachServer(options, next => game.restart(next));
 * await game.stop(); // on SIGINT
 * ```
 */
export type GameServer = {
  /**
   * The server running now: a new one after each restart.
   *
   * @returns The current server.
   */
  current(): AttachedServer;
  /**
   * Closes every editor socket with 1012 "editor restarting", stops the current server, bounded,
   * waits for Bun's bundler to be idle when `options` have HMR, bounded (D-57), and serves
   * `options` on its port. Runs after every earlier restart; serves nothing after stop.
   *
   * @param options - The next serve options (their port is replaced by the real one).
   * @returns Resolves once the new server runs; rejects when it cannot start (the stopped server
   * stays current).
   */
  restart(options: BunServeOptions): Promise<void>;
  /**
   * Stops the current server, bounded, after a restart under way.
   *
   * @returns Resolves once stopped, or after STOP_GRACE_MS; a restart under way runs first.
   */
  stop(): Promise<void>;
};

/**
 * Bun.serve, read at call time so a test spy on it sees the call.
 *
 * @param options - The serve options.
 * @returns The running server.
 */
function serveWithBun(options: BunServeOptions): AttachedServer {
  return Bun.serve(options);
}

/**
 * The real wait for Bun's bundler (D-57): an empty build that lives in memory. Bun runs
 * `Bun.build` on the thread that rebundles the page of a server without HMR, one job after
 * another, so this build ends only after a page rebundle still in flight. Bun.build is read at
 * call time, so a test spy on it sees the call.
 *
 * It works around a deadlock of Bun 1.3.14: when that rebundle (Bun starts one on every page
 * request without HMR) and the first bundle of the dev server run at once, both wait on one
 * wait group of Bun's thread pool and the main thread is never woken, so the bin answers nothing,
 * not even SIGINT; sometimes Bun crashes instead. Remove this wait and its call in `restart` once
 * Bun no longer freezes there.
 *
 * @returns Resolves once the bundler finished what it had; rejects when the build fails.
 */
async function waitForBundler(): Promise<void> {
  await Bun.build({ entrypoints: [IDLE_ENTRY], files: { [IDLE_ENTRY]: "" } });
}

/**
 * The default warning sink: a game server made without one says nothing.
 */
function keepQuiet(): void {
  // No sink was given.
}

/**
 * Stops a server with its open connections, waiting at most STOP_GRACE_MS.
 *
 * @param server - The server.
 * @returns Resolves once stopped, or after the grace time.
 */
function stopBounded(server: AttachedServer): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const grace = new Promise<void>(resolve => {
    timer = setTimeout(resolve, STOP_GRACE_MS);
  });
  return Promise.race([server.stop(true), grace]).finally(() => {
    clearTimeout(timer);
  });
}

/**
 * Waits until Bun's bundler is idle, at most BUNDLER_IDLE_MS, and never rejects: a wait that is
 * cut or fails is one warning, and the restart goes on.
 *
 * @param idle - The wait.
 * @param warn - Hears why the wait was given up.
 * @returns Resolves once the bundler is idle, the time is up or the wait failed.
 */
async function idleBounded(idle: BundlerIdle, warn: (message: string) => void): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<boolean>(resolve => {
    timer = setTimeout(resolve, BUNDLER_IDLE_MS, true);
  });
  try {
    const isLate = await Promise.race([idle().then(() => false), late]);
    if (isLate) {
      warn(`[moku-editor] Bun's bundler was still busy after ${BUNDLER_IDLE_MS} ms: ${GOES_ON}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warn(`[moku-editor] the wait for Bun's bundler failed (${message}): ${GOES_ON}`);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The options on a fixed port: a server started on port 0 keeps the port it got. A server
 * without a port (a unix socket) gets the options as they are.
 *
 * @param options - The serve options.
 * @param port - The real port, undefined when the server has none.
 * @returns The options with that port.
 * @example
 * ```ts
 * onPort({ port: 0, routes }, 3001); // { port: 3001, routes }
 * ```
 */
function onPort(options: BunServeOptions, port: number | undefined): BunServeOptions {
  if (port === undefined) return options;
  // Object.assign types the copy as an intersection; a spread does not fit Bun's exclusive union.
  return Object.assign({}, options, { port });
}

/**
 * Serves the options and returns the bin's game server around that server.
 *
 * @param options - The first serve options (the result of `hub.serve`).
 * @param closeAll - Closes every editor socket before a restart's stop (`hub.closeAll`).
 * @param seams - The server start, the wait for Bun's bundler and the warning sink.
 * @returns The game server.
 * @example
 * ```ts
 * const game = createGameServer(options, (code, reason) => editor.hub.closeAll(code, reason));
 * await game.restart({ ...options, development: { hmr: false, console: true } });
 * game.current().port; // the same port as before
 * ```
 */
export function createGameServer(
  options: BunServeOptions,
  closeAll: CloseSockets,
  seams: GameServerSeams = {}
): GameServer {
  const { serve = serveWithBun, bundlerIdle = waitForBundler, warn = keepQuiet } = seams;
  let current = serve(options);
  const { port } = current;
  let stopped = false;
  let queue: Promise<void> = Promise.resolve();

  /**
   * Runs a step after every earlier one; a failed step does not hold up the next.
   *
   * @param step - The step.
   * @returns The step's own result.
   */
  const enqueue = (step: () => Promise<void>): Promise<void> => {
    const run = queue.then(step);
    queue = run.catch(() => {
      // The caller of the failed step handles its rejection.
    });
    return run;
  };

  return {
    current: () => current,
    restart: next =>
      enqueue(async () => {
        if (stopped) return;
        // The close frames go out before the stop: a client sees 1012, not a dropped socket.
        await closeAll(SERVICE_RESTART, RESTARTING);
        await stopBounded(current);
        // Only a server with HMR bundles on the main thread, so only it must not start next to a
        // page rebundle in flight (D-57). Before a server without HMR the empty build could itself
        // run next to a bundle of the stopped dev server, the same pair.
        if (hmrOf(next.development)) await idleBounded(bundlerIdle, warn);
        current = serve(onPort(next, port));
      }),
    stop: () =>
      enqueue(() => {
        stopped = true;
        return stopBounded(current);
      })
  };
}
