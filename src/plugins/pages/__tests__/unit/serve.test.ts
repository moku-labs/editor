import type { Mock } from "vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BunServeOptions } from "../../../hub/types";
import type { BundlerIdle, CloseSockets } from "../../serve";
import { BUNDLER_IDLE_MS, createGameServer, SERVICE_RESTART, STOP_GRACE_MS } from "../../serve";
import type { AttachedServer } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// The bin's game server (D-32, A9): one mutable current server; a restart stops
// it (bounded) and serves the next options on the same port; stop and every
// restart reach the current one, one after another.
// ─────────────────────────────────────────────────────────────────────────────

/** A fake Bun server: the options it was served with, a port and a recorded stop. */
type FakeServer = AttachedServer & {
  readonly options: BunServeOptions;
  readonly stop: Mock<(closeActiveConnections?: boolean) => Promise<void>>;
};

/** A closeAll that closes nothing, for the cases about the server alone. */
const keepSockets: CloseSockets = async () => undefined;

/** A bundler that is idle at once, for the cases about the server alone. */
const idleNow: BundlerIdle = async () => undefined;

/** A bundler whose wait rejects. */
const brokenBundler: BundlerIdle = () => Promise.reject(new Error("no bundler"));

/**
 * A bundler whose wait throws before it returns a promise.
 *
 * @throws {TypeError} Always.
 */
const throwingBundler: BundlerIdle = () => {
  throw new TypeError("Bun.build is not a function");
};

/** The real port the fake gives a server asked for port 0. */
const REAL_PORT = 4321;

/**
 * Serve options with a port and a development value.
 *
 * @param port - The asked port.
 * @param hmr - Bun HMR on or off.
 * @returns The options.
 */
function optionsOf(port: number, hmr: boolean): BunServeOptions {
  return { port, development: { hmr, console: true } } as unknown as BunServeOptions;
}

/**
 * A fake serve function that records every server it starts.
 *
 * @returns The serve mock and the started servers.
 */
function fakeServe() {
  const served: FakeServer[] = [];
  const serve = vi.fn((options: BunServeOptions): FakeServer => {
    const asked = Number(options.port);
    const server: FakeServer = {
      options,
      port: asked === 0 ? REAL_PORT : asked,
      stop: vi.fn(() => Promise.resolve())
    };
    served.push(server);
    return server;
  });
  return { serve, served };
}

/**
 * The server at an index, failing the test when it is missing.
 *
 * @param served - The started servers.
 * @param index - Its index.
 * @returns The server.
 */
function at(served: readonly FakeServer[], index: number): FakeServer {
  const server = served[index];
  if (server === undefined) throw new Error(`no server ${index}`);
  return server;
}

afterEach(() => {
  vi.useRealTimers();
});

describe("createGameServer", () => {
  it("serves the options once; that server is the current one", () => {
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });

    expect(serve).toHaveBeenCalledTimes(1);
    expect(game.current()).toBe(at(served, 0));
    expect(game.current().port).toBe(REAL_PORT);
  });

  it("lets a serve failure through (the bin reports the taken port)", () => {
    const serve = vi.fn((): AttachedServer => {
      throw new Error("Failed to start server. Is port 3000 in use?");
    });
    expect(() => createGameServer(optionsOf(3000, true), keepSockets, { serve })).toThrow("in use");
  });
});

describe("restart", () => {
  it('closes every socket with 1012 "editor restarting" before Bun\'s stop (U11)', async () => {
    const { serve, served } = fakeServe();
    const closeAll = vi.fn<CloseSockets>(async () => undefined);
    const game = createGameServer(optionsOf(0, true), closeAll, { serve });

    await game.restart(optionsOf(0, false));

    expect(SERVICE_RESTART).toBe(1012);
    expect(closeAll).toHaveBeenCalledExactlyOnceWith(1012, "editor restarting");
    expect(closeAll.mock.invocationCallOrder[0]).toBeLessThan(
      at(served, 0).stop.mock.invocationCallOrder[0] ?? 0
    );
  });

  it("stops the server only after the sockets reported their close: the 1012 frame goes out", async () => {
    const { serve, served } = fakeServe();
    const closed = Promise.withResolvers<void>();
    const closeAll = vi.fn<CloseSockets>(() => closed.promise);
    const game = createGameServer(optionsOf(0, true), closeAll, { serve });

    const restart = game.restart(optionsOf(0, false));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(at(served, 0).stop).not.toHaveBeenCalled();

    closed.resolve();
    await restart;
    expect(at(served, 0).stop).toHaveBeenCalled();
  });

  it("closes no socket on the final stop nor on a restart after it", async () => {
    const { serve } = fakeServe();
    const closeAll = vi.fn<CloseSockets>();
    const game = createGameServer(optionsOf(0, true), closeAll, { serve });

    await game.stop();
    await game.restart(optionsOf(0, false));

    expect(closeAll).not.toHaveBeenCalled();
  });

  it("stops the current server with force, then serves the next options on its real port", async () => {
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });

    await game.restart(optionsOf(0, false));

    expect(at(served, 0).stop).toHaveBeenCalledWith(true);
    expect(serve).toHaveBeenCalledTimes(2);
    expect(at(served, 1).options).toEqual(optionsOf(REAL_PORT, false));
    expect(game.current()).toBe(at(served, 1));
    expect(at(served, 0).stop.mock.invocationCallOrder[0]).toBeLessThan(
      serve.mock.invocationCallOrder[1] ?? 0
    );
  });

  it("serves the next options as they are when the server has no port (a unix socket)", async () => {
    const served: BunServeOptions[] = [];
    const serve = vi.fn((options: BunServeOptions): AttachedServer => {
      served.push(options);
      return { stop: () => Promise.resolve() };
    });
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });

    await game.restart(optionsOf(0, false));
    expect(served).toEqual([optionsOf(0, true), optionsOf(0, false)]);
  });

  it("gives up on a stop that does not resolve after STOP_GRACE_MS, then serves", async () => {
    vi.useFakeTimers();
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });
    at(served, 0).stop.mockReturnValue(
      new Promise(() => {
        // Bun's stop while a close is in flight: never resolves.
      })
    );

    const restarted = game.restart(optionsOf(0, false));
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - 1);
    expect(serve).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await restarted;
    expect(serve).toHaveBeenCalledTimes(2);
  });

  it("rejects when the next serve fails; the stopped server stays the current one", async () => {
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve, bundlerIdle: idleNow });
    serve.mockImplementationOnce(() => {
      throw new Error("port 4321 is in use");
    });

    await expect(game.restart(optionsOf(0, false))).rejects.toThrow("port 4321 is in use");
    expect(game.current()).toBe(at(served, 0));

    await game.restart(optionsOf(0, true));
    expect(at(served, 1).options).toEqual(optionsOf(REAL_PORT, true));
    expect(game.current()).toBe(at(served, 1));
  });

  it("runs restarts one after another: the second stops the server the first served", async () => {
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve, bundlerIdle: idleNow });
    const stopping = Promise.withResolvers<void>();
    at(served, 0).stop.mockReturnValue(stopping.promise);

    const first = game.restart(optionsOf(0, false));
    const second = game.restart(optionsOf(0, true));
    await Promise.resolve();
    expect(serve).toHaveBeenCalledTimes(1);

    stopping.resolve();
    await Promise.all([first, second]);
    expect(served.map(server => server.options)).toEqual([
      optionsOf(0, true),
      optionsOf(REAL_PORT, false),
      optionsOf(REAL_PORT, true)
    ]);
    expect(at(served, 1).stop).toHaveBeenCalledWith(true);
    expect(game.current()).toBe(at(served, 2));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// The wait for Bun's bundler (D-57): before a server with HMR starts, no page
// rebundle of the stopped server is left in flight. Bun 1.3.14 freezes or
// crashes when that rebundle and the dev server's first bundle run at once.
// ─────────────────────────────────────────────────────────────────────────────

describe("restart: the wait for Bun's bundler (D-57)", () => {
  it("waits for the bundler after the stop and before the next serve, when the next server has HMR", async () => {
    const { serve, served } = fakeServe();
    const idle = Promise.withResolvers<void>();
    const bundlerIdle = vi.fn<BundlerIdle>(() => idle.promise);
    const warn = vi.fn<(message: string) => void>();
    const game = createGameServer(optionsOf(0, false), keepSockets, { serve, bundlerIdle, warn });

    const restarted = game.restart(optionsOf(0, true));
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(at(served, 0).stop).toHaveBeenCalledWith(true);
    expect(bundlerIdle).toHaveBeenCalledTimes(1);
    expect(serve).toHaveBeenCalledTimes(1);

    idle.resolve();
    await restarted;
    expect(serve).toHaveBeenCalledTimes(2);
    expect(at(served, 1).options).toEqual(optionsOf(REAL_PORT, true));
    expect(at(served, 0).stop.mock.invocationCallOrder[0]).toBeLessThan(
      bundlerIdle.mock.invocationCallOrder[0] ?? 0
    );
    expect(bundlerIdle.mock.invocationCallOrder[0]).toBeLessThan(
      serve.mock.invocationCallOrder[1] ?? 0
    );
    expect(warn).not.toHaveBeenCalled();
  });

  it("does not wait for the bundler before a server without HMR", async () => {
    const { serve } = fakeServe();
    const bundlerIdle = vi.fn<BundlerIdle>(idleNow);
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve, bundlerIdle });

    await game.restart(optionsOf(0, false));

    expect(bundlerIdle).not.toHaveBeenCalled();
    expect(serve).toHaveBeenCalledTimes(2);
  });

  it("cuts a wait that never settles at BUNDLER_IDLE_MS, warns once and serves", async () => {
    vi.useFakeTimers();
    const { serve } = fakeServe();
    const warn = vi.fn<(message: string) => void>();
    const bundlerIdle = vi.fn<BundlerIdle>(
      () =>
        new Promise(() => {
          // A bundler that never comes back.
        })
    );
    const game = createGameServer(optionsOf(0, false), keepSockets, { serve, bundlerIdle, warn });

    const restarted = game.restart(optionsOf(0, true));
    await vi.advanceTimersByTimeAsync(BUNDLER_IDLE_MS - 1);
    expect(bundlerIdle).toHaveBeenCalledTimes(1);
    expect(serve).toHaveBeenCalledTimes(1);
    expect(warn).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await restarted;
    expect(serve).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining(`still busy after ${BUNDLER_IDLE_MS} ms`)
    );
  });

  it("serves when the wait rejects, and warns once with its message", async () => {
    const { serve } = fakeServe();
    const warn = vi.fn<(message: string) => void>();
    const seams = { serve, bundlerIdle: brokenBundler, warn };
    const game = createGameServer(optionsOf(0, false), keepSockets, seams);

    await expect(game.restart(optionsOf(0, true))).resolves.toBeUndefined();

    expect(serve).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining("no bundler"));
  });

  it("serves when the wait throws at once, and warns once", async () => {
    const { serve } = fakeServe();
    const warn = vi.fn<(message: string) => void>();
    const seams = { serve, bundlerIdle: throwingBundler, warn };
    const game = createGameServer(optionsOf(0, false), keepSockets, seams);

    await expect(game.restart(optionsOf(0, true))).resolves.toBeUndefined();

    expect(serve).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("Bun.build is not a function")
    );
  });

  it("warns nowhere by default: a cut wait still serves", async () => {
    const { serve } = fakeServe();
    const seams = { serve, bundlerIdle: brokenBundler };
    const game = createGameServer(optionsOf(0, false), keepSockets, seams);

    await game.restart(optionsOf(0, true));

    expect(serve).toHaveBeenCalledTimes(2);
  });

  it("by default waits with an empty build that lives in memory: Bun queues it behind a page rebundle", async () => {
    const build = vi.spyOn(Bun, "build");
    const { serve } = fakeServe();
    const game = createGameServer(optionsOf(0, false), keepSockets, { serve });

    try {
      await game.restart(optionsOf(0, true));

      expect(build).toHaveBeenCalledTimes(1);
      const config = build.mock.calls[0]?.[0];
      expect(config?.entrypoints).toHaveLength(1);
      expect(config?.files).toEqual({ [config?.entrypoints[0] ?? ""]: "" });
      expect(build.mock.invocationCallOrder[0]).toBeLessThan(
        serve.mock.invocationCallOrder[1] ?? 0
      );
    } finally {
      build.mockRestore();
    }
  });

  it("does not wait on a restart after stop", async () => {
    const { serve } = fakeServe();
    const bundlerIdle = vi.fn<BundlerIdle>(idleNow);
    const game = createGameServer(optionsOf(0, false), keepSockets, { serve, bundlerIdle });

    await game.stop();
    await game.restart(optionsOf(0, true));

    expect(bundlerIdle).not.toHaveBeenCalled();
  });
});

describe("stop", () => {
  it("stops the current server: the restarted one, not the first", async () => {
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });
    await game.restart(optionsOf(0, false));

    await game.stop();

    expect(at(served, 0).stop).toHaveBeenCalledTimes(1);
    expect(at(served, 1).stop).toHaveBeenCalledWith(true);
  });

  it("waits for a restart under way, then stops the server it served", async () => {
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });

    const restarted = game.restart(optionsOf(0, false));
    await game.stop();
    await restarted;

    expect(at(served, 1).stop).toHaveBeenCalledWith(true);
  });

  it("is bounded by STOP_GRACE_MS", async () => {
    vi.useFakeTimers();
    const { serve, served } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });
    at(served, 0).stop.mockReturnValue(
      new Promise(() => {
        // Never resolves.
      })
    );

    const stopped = vi.fn();
    game.stop().then(stopped, stopped);
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
    expect(stopped).toHaveBeenCalledTimes(1);
  });

  it("a restart after stop serves nothing", async () => {
    const { serve } = fakeServe();
    const game = createGameServer(optionsOf(0, true), keepSockets, { serve });

    await game.stop();
    await game.restart(optionsOf(0, false));

    expect(serve).toHaveBeenCalledTimes(1);
  });
});
