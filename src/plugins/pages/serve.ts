/**
 * @file pages plugin — the bin's game server (D-32, A9): one mutable current Bun server. The Hot
 * reload switch restarts it with new options on the same port: Bun's stop, bounded (it does not
 * resolve while a close is in flight), then Bun.serve. Restarts and the final stop run one after
 * another and always reach the current server. The hub is not touched, so its token stays.
 */
import type { BunServeOptions } from "../hub/types";
import type { AttachedServer } from "./types";

/**
 * How long a stop waits for Bun's server stop before it gives up.
 */
export const STOP_GRACE_MS = 500;

/**
 * Starts a server: Bun.serve in the bin, a fake in tests. Throws when the port is taken.
 */
export type StartServer = (options: BunServeOptions) => AttachedServer;

/**
 * The bin's game server: the current Bun server, its restart and its stop.
 *
 * @example
 * ```ts
 * const game = createGameServer(editor.hub.serve({ port: 0, routes }));
 * editor.pages.attachServer(game.current(), options, next => game.restart(next));
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
   * Stops the current server, bounded, and serves `options` on its port. Runs after every earlier
   * restart; serves nothing after stop.
   *
   * @param options - The next serve options (their port is replaced by the real one).
   * @returns Resolves once the new server runs; rejects when it cannot start (the stopped server
   * stays current).
   */
  restart(options: BunServeOptions): Promise<void>;
  /**
   * Stops the current server, bounded, after a restart under way.
   *
   * @returns Resolves once stopped, or after STOP_GRACE_MS.
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
 * @param serve - Starts a server (default Bun.serve).
 * @returns The game server.
 * @example
 * ```ts
 * const game = createGameServer(options);
 * await game.restart({ ...options, development: { hmr: false, console: true } });
 * game.current().port; // the same port as before
 * ```
 */
export function createGameServer(
  options: BunServeOptions,
  serve: StartServer = serveWithBun
): GameServer {
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
        await stopBounded(current);
        current = serve(onPort(next, port));
      }),
    stop: () =>
      enqueue(() => {
        stopped = true;
        return stopBounded(current);
      })
  };
}
