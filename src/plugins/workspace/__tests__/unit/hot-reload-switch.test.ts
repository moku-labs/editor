// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setHotReload, toggleHotReload } from "../../hot-reload";
import { CONFIG, createCtx, flush, manifestOf, resultOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// An accepted Hot reload switch (D-32): the bin restarts its server, so the
// game page must load again to gain or drop Bun's HMR client. workspace takes
// the checkpoint before it asks, waits for this tab's game to connect to the
// restarted server, then reloads the frame and restores the checkpoint.
// ─────────────────────────────────────────────────────────────────────────────

const BOOKMARK = { checkpoint: "home", frame: 1203 };
const COMMANDS = ["game.step", "game.bookmark", "game.restore"];
const RESTORED = "Game reloaded · state restored from the last checkpoint";

let ctx: TestCtx;
let srcWrites: string[];

/**
 * A mounted ctx under the bin with hot reload on: a live embedded game that lists bookmark and
 * restore, and a link that accepts the switch.
 */
function mountedCtx(): void {
  ctx = createCtx();
  const iframe = document.createElement("iframe");
  srcWrites = [];
  Object.defineProperty(iframe, "src", {
    configurable: true,
    get: () => srcWrites.at(-1) ?? "",
    set: (value: string) => {
      srcWrites.push(value);
    }
  });
  ctx.state.frame.iframe = iframe;
  ctx.state.link = { kind: "live", frame: 1840 };
  ctx.link.current = { kind: "live", frame: 1840 };
  ctx.link.manifestValue = manifestOf(COMMANDS);
  ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
  ctx.link.setHotReload.mockResolvedValue(true);
  ctx.link.run.mockImplementation(id =>
    Promise.resolve(id === "game.bookmark" ? resultOf(BOOKMARK) : resultOf())
  );
}

/**
 * The texts of the visible toasts.
 *
 * @returns The messages.
 */
function toasts(): string[] {
  return ctx.state.toasts.map(toast => toast.message);
}

/**
 * The ids of the commands link ran, in order.
 *
 * @returns The ids.
 */
function ranIds(): string[] {
  return ctx.link.run.mock.calls.map(call => call[0]);
}

beforeEach(() => {
  vi.useFakeTimers();
  mountedCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("an accepted switch", () => {
  it("bookmarks first, reloads the frame once the game is back on the restarted server, and restores", async () => {
    await expect(setHotReload(ctx, false)).resolves.toBe(true);
    expect(ranIds()).toEqual(["game.bookmark"]);
    expect(ctx.link.run.mock.invocationCallOrder[0]).toBeLessThan(
      ctx.link.setHotReload.mock.invocationCallOrder[0] ?? 0
    );
    expect(toasts()).toEqual(["Hot reload off"]);

    // The server restarts: the frame waits for the game to connect again.
    await flush();
    expect(srcWrites).toEqual([]);

    // The game is back on the restarted server: the page loads again, without Bun's HMR client.
    ctx.link.attach(manifestOf(COMMANDS));
    await flush();
    expect(srcWrites).toHaveLength(1);

    // The reloaded page's session gets the checkpoint taken before the switch.
    ctx.link.attach(manifestOf(COMMANDS));
    await flush();
    expect(ranIds()).toEqual(["game.bookmark", "game.restore"]);
    expect(ctx.link.run).toHaveBeenLastCalledWith("game.restore", { bookmark: BOOKMARK });
    expect(toasts()).toEqual(["Hot reload off", RESTORED]);
  });

  it("key H flips through the same path", async () => {
    toggleHotReload(ctx);
    await flush();
    expect(ctx.link.setHotReload).toHaveBeenCalledWith(false);
    ctx.link.attach(manifestOf(COMMANDS));
    await flush();
    expect(srcWrites).toHaveLength(1);
  });

  it("a game that does not come back within reloadTimeoutMs: the frame reloads all the same", async () => {
    await setHotReload(ctx, false);
    await vi.advanceTimersByTimeAsync(CONFIG.reloadTimeoutMs);
    expect(srcWrites).toHaveLength(1);
  });

  it("a game outside the editor is not waited for: the toast says to reload it there", async () => {
    ctx.link.manifestValue = manifestOf(COMMANDS, false);
    await setHotReload(ctx, false);
    await flush();
    expect(srcWrites).toEqual([]);
    expect(toasts()).toEqual([
      "Hot reload off",
      "The game runs outside the editor · reload it there"
    ]);
  });

  it("a stop while waiting reloads nothing", async () => {
    await setHotReload(ctx, false);
    ctx.state.stopped = true;
    for (const cleanup of ctx.state.dom.cleanup) cleanup();
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await flush();
    expect(srcWrites).toEqual([]);
  });
});

describe("no reload", () => {
  it("after a failed switch: the wait ends and the hint toasts", async () => {
    ctx.link.setHotReload.mockResolvedValue(false);
    await expect(setHotReload(ctx, false)).resolves.toBe(false);
    expect(ctx.link.manifestListeners.size).toBe(0);
    ctx.link.attach(manifestOf(COMMANDS));
    await flush();
    expect(srcWrites).toEqual([]);
    expect(toasts()).toEqual([
      "Could not switch · start the bin with --no-hmr to turn hot reload off"
    ]);
  });

  it("for the value hot reload already has: no bookmark either", async () => {
    await expect(setHotReload(ctx, true)).resolves.toBe(true);
    ctx.link.attach(manifestOf(COMMANDS));
    await flush();
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(srcWrites).toEqual([]);
    expect(toasts()).toEqual(["Hot reload on"]);
  });

  it("for a game's own server: no bookmark, no wait", async () => {
    ctx.link.hotReload.mockReturnValue({ hmr: false, owner: "server" });
    ctx.link.setHotReload.mockResolvedValue(false);
    await expect(setHotReload(ctx, true)).resolves.toBe(false);
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(ctx.link.manifestListeners.size).toBe(0);
  });
});
