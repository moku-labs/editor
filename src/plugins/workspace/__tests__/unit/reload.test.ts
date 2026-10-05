// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { createGameFrame, gameUrl, taggedGameUrl } from "../../frame/frame";
import type { Taken } from "../../frame/reload";
import { nextManifest, reloadFrame } from "../../frame/reload";
import { RESTORED_TOAST } from "../../frame/restored";
import { createCtx, flush, manifestOf, resultOf, type TestCtx, tagged } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// D-07 reload: bookmark → reload the frame in place → restore on the new
// session → toast; the frame URL comes from link.boot().gameUrl
// ─────────────────────────────────────────────────────────────────────────────

const BOOKMARK = { checkpoint: "home", frame: 1203 };

let ctx: TestCtx;
let iframe: HTMLIFrameElement;
let srcWrites: string[];

/**
 * A mounted ctx: a live embedded session that lists bookmark and restore.
 */
function mountedCtx(): void {
  ctx = createCtx();
  iframe = document.createElement("iframe");
  srcWrites = [];
  const setter = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, "src")?.set;
  Object.defineProperty(iframe, "src", {
    configurable: true,
    get: () => iframe.getAttribute("src") ?? "",
    set: (value: string) => {
      srcWrites.push(value);
      setter?.call(iframe, value);
    }
  });
  ctx.state.frame.iframe = iframe;
  ctx.state.link = { kind: "live", frame: 1840 };
  ctx.link.current = { kind: "live", frame: 1840 };
  ctx.link.manifestValue = manifestOf(["game.step", "game.bookmark", "game.restore"]);
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

beforeEach(() => {
  vi.useFakeTimers();
  mountedCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("gameUrl", () => {
  it("resolves boot.gameUrl against the tools page, '/' without a boot", () => {
    expect(gameUrl(ctx)).toBe(new URL("/game/", location.href).href);
    ctx.link.bootValue = undefined;
    expect(gameUrl(ctx)).toBe(new URL("/", location.href).href);
  });

  it("taggedGameUrl is the game URL tagged with the frame id of this tools page", () => {
    expect(taggedGameUrl(ctx)).toBe(tagged(gameUrl(ctx)));
    expect(ctx.link.frameUrl).toHaveBeenCalledWith(gameUrl(ctx));
  });
});

/**
 * Tracks whether a promise settled.
 *
 * @param promise - The promise.
 * @returns Reads true once it settled.
 */
function settledOf(promise: Promise<unknown>): () => boolean {
  let settled = false;
  promise
    .finally(() => {
      settled = true;
    })
    .catch(() => {});
  return () => settled;
}

/**
 * Runs `game.bookmark` with BOOKMARK, rejects the given command with a wire error, and answers
 * the rest with an empty result.
 *
 * @param failing - The command id that fails.
 * @param message - Its error message.
 */
function failOn(failing: string, message: string): void {
  ctx.link.run.mockImplementation(id => {
    if (id === failing) return Promise.reject(wireError(-32_000, message));
    return Promise.resolve(id === "game.bookmark" ? resultOf(BOOKMARK) : resultOf());
  });
}

/**
 * The ids of the commands link ran, in order.
 *
 * @returns The ids.
 */
function ranIds(): string[] {
  return ctx.link.run.mock.calls.map(call => call[0]);
}

describe("reloadFrame tells link the reload is expected (U7)", () => {
  it("calls link.expectReload right before it reloads the frame", async () => {
    const pending = reloadFrame(ctx, {});
    await flush();
    expect(ctx.link.expectReload).toHaveBeenCalledTimes(1);
    const [order] = ctx.link.expectReload.mock.invocationCallOrder;
    expect(srcWrites).toHaveLength(1);
    expect(order).toBeLessThan(ctx.link.frameUrl.mock.invocationCallOrder.at(-1) ?? 0);
    ctx.link.attach(manifestOf());
    await pending;
  });

  it("a game outside the editor is not reloaded, so no reload is expected", async () => {
    ctx.link.manifestValue = { ...manifestOf(), embedded: false };
    await reloadFrame(ctx, {});
    expect(ctx.link.expectReload).not.toHaveBeenCalled();
  });
});

describe("reloadFrame keeps the pause", () => {
  const COMMANDS = ["game.bookmark", "game.restore", "game.pause"];

  it("a game paused before the reload is paused again after the restore", async () => {
    ctx.state.link = { kind: "paused", frame: 1840 };
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ranIds()).toEqual(["game.bookmark", "game.restore", "game.pause"]);
    expect(toasts()).toEqual(["Game reloaded · state restored from the last checkpoint"]);
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("a live game is not paused after the restore", async () => {
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ranIds()).toEqual(["game.bookmark", "game.restore"]);
  });

  it("a failed pause warns and keeps the restored result", async () => {
    ctx.state.link = { kind: "paused", frame: 1840 };
    failOn("game.pause", "pause refused");
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ctx.log.warn).toHaveBeenCalledWith("workspace:pause-failed", {
      message: "[moku-editor] pause refused"
    });
    expect(toasts()).toEqual(["Game reloaded · state restored from the last checkpoint"]);
  });

  it("no pause without game.pause in the new manifest, nor after a failed restore", async () => {
    ctx.state.link = { kind: "paused", frame: 1840 };
    const first = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(["game.bookmark", "game.restore"]));
    await expect(first).resolves.toEqual({ restored: true });
    expect(ranIds()).toEqual(["game.bookmark", "game.restore"]);

    ctx.link.run.mockClear();
    failOn("game.restore", "shape changed");
    const second = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(second).resolves.toEqual({ restored: false, reason: "restore_failed" });
    expect(ranIds()).toEqual(["game.bookmark", "game.restore"]);
  });
});

describe("reloadFrame", () => {
  it("before the first mount resolves not_mounted and touches nothing", async () => {
    ctx.state.frame.iframe = undefined;
    await expect(reloadFrame(ctx, { restore: true })).resolves.toEqual({
      restored: false,
      reason: "not_mounted"
    });
    expect(ctx.link.run).not.toHaveBeenCalled();
  });

  it("restore: bookmark → reload in place → new hello → restore → toast", async () => {
    const pending = reloadFrame(ctx, { restore: true });
    await flush();

    expect(ctx.link.run.mock.calls[0]?.[0]).toBe("game.bookmark");
    expect(srcWrites).toEqual([taggedGameUrl(ctx)]);

    // the immediate call of the existing manifest and the lost (undefined) call are ignored
    ctx.link.attach(undefined);
    await flush();
    expect(ctx.link.run).toHaveBeenCalledTimes(1);

    ctx.link.attach(manifestOf(["game.bookmark", "game.restore"]));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ctx.link.run).toHaveBeenLastCalledWith("game.restore", { bookmark: BOOKMARK });
    expect(toasts()).toEqual(["Game reloaded · state restored from the last checkpoint"]);
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.state.frame.reload).toBeUndefined();
  });

  it("without restore it only reloads and toasts Game reloaded", async () => {
    const pending = reloadFrame(ctx, {});
    await flush();
    ctx.link.attach(manifestOf());
    await expect(pending).resolves.toEqual({ restored: false });
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(toasts()).toEqual(["Game reloaded"]);
  });

  it("a failed bookmark warns and continues with bookmark_failed", async () => {
    ctx.link.run.mockRejectedValue(wireError(-32_000, "no checkpoint"));
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    expect(ctx.log.warn).toHaveBeenCalledWith("workspace:bookmark-failed", {
      message: "[moku-editor] no checkpoint"
    });
    expect(srcWrites).toHaveLength(1);

    ctx.link.attach(manifestOf(["game.restore"]));
    await expect(pending).resolves.toEqual({ restored: false, reason: "bookmark_failed" });
    expect(toasts()).toEqual(["Game reloaded"]);
  });

  it("a not embedded session toasts and does not reload", async () => {
    ctx.link.manifestValue = manifestOf(["game.bookmark"], false);
    await expect(reloadFrame(ctx, { restore: true })).resolves.toEqual({
      restored: false,
      reason: "not_embedded"
    });
    expect(srcWrites).toEqual([]);
    expect(toasts()).toEqual(["The game runs outside the editor · reload it there"]);
  });

  it("no session: reloads without a bookmark and reports no_session", async () => {
    ctx.state.link = { kind: "connecting" };
    ctx.link.manifestValue = undefined;
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    expect(ctx.link.run).not.toHaveBeenCalled();
    ctx.link.attach(manifestOf());
    await expect(pending).resolves.toEqual({ restored: false, reason: "no_session" });
  });

  it("a manifest of a not embedded session does not end the wait", async () => {
    const pending = reloadFrame(ctx, {});
    await flush();
    ctx.link.attach(manifestOf([], false));
    ctx.link.attach(manifestOf([]));
    await expect(pending).resolves.toEqual({ restored: false });
  });

  it("a manifest of another tools tab's frame does not end the wait; its own does", async () => {
    const pending = reloadFrame(ctx, {});
    const settled = settledOf(pending);
    await flush();
    ctx.link.attach({ ...manifestOf([]), page: tagged("http://127.0.0.1:3000/", "f-other") });
    await flush();
    expect(settled()).toBe(false);

    ctx.link.attach({ ...manifestOf([]), page: tagged("http://127.0.0.1:3000/") });
    await expect(pending).resolves.toEqual({ restored: false });
  });

  it("times out after reloadTimeoutMs with a toast", async () => {
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    await vi.advanceTimersByTimeAsync(15_000);
    await expect(pending).resolves.toEqual({ restored: false, reason: "timeout" });
    expect(toasts()).toEqual(["Game reloaded · no game connected after 15 s"]);
    expect(ctx.link.manifestListeners.size).toBe(0);
  });

  it("a failed restore toasts the bare message and warns", async () => {
    ctx.link.run.mockImplementation(id =>
      id === "game.bookmark"
        ? Promise.resolve(resultOf(BOOKMARK))
        : Promise.reject(wireError(-32_000, "game.restore: shape changed"))
    );
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(["game.restore"]));
    await expect(pending).resolves.toEqual({ restored: false, reason: "restore_failed" });
    expect(toasts()).toEqual(["Game reloaded · restore failed: game.restore: shape changed"]);
    expect(ctx.log.warn).toHaveBeenCalledWith("workspace:restore-failed", {
      message: "[moku-editor] game.restore: shape changed"
    });
  });

  it("a new session without game.restore reloads without restoring", async () => {
    const pending = reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(["game.step"]));
    await expect(pending).resolves.toEqual({ restored: false });
    expect(toasts()).toEqual(["Game reloaded"]);
  });

  it("concurrent calls share one run; the again flag starts exactly one more", async () => {
    const first = reloadFrame(ctx, { restore: true });
    const second = reloadFrame(ctx, { restore: true });
    const third = reloadFrame(ctx, { restore: true });
    expect(second).toBe(first);
    expect(third).toBe(first);
    await flush();
    expect(srcWrites).toHaveLength(1);

    ctx.link.attach(manifestOf(["game.restore"]));
    await expect(first).resolves.toEqual({ restored: true });
    await flush();
    expect(srcWrites).toHaveLength(2);
    expect(ctx.state.frame.reload).toBeDefined();

    ctx.link.attach(manifestOf(["game.restore"]));
    await flush();
    expect(ctx.state.frame.reload).toBeUndefined();
    expect(srcWrites).toHaveLength(2);
  });

  it("a stop while waiting ends the run quietly", async () => {
    const pending = reloadFrame(ctx, {});
    await flush();
    ctx.state.stopped = true;
    for (const cleanup of ctx.state.dom.cleanup) cleanup();
    await expect(pending).resolves.toEqual({ restored: false, reason: "timeout" });
    expect(toasts()).toEqual([]);
  });
});

describe("reloadFrame after a save with Bun hot reload on (round 2 R6)", () => {
  const COMMANDS = ["game.bookmark", "game.restore", "game.pause"];
  const RESTORE = { bookmark: JSON.stringify(BOOKMARK), frame: 1840 };

  beforeEach(() => {
    ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
  });

  it("Bun's new session that restored the state ends the run: no second reload, restore or pause", async () => {
    ctx.state.link = { kind: "paused", frame: 1840 };
    const pending = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    expect(srcWrites).toEqual([]);

    ctx.link.attach({ ...manifestOf(COMMANDS), restored: RESTORE });
    await expect(pending).resolves.toEqual({ restored: true });
    expect(srcWrites).toEqual([]);
    expect(ranIds()).toEqual(["game.bookmark"]);
    expect(toasts()).toEqual([RESTORED_TOAST]);
    expect(ctx.state.lastRestore).toBeDefined();
  });

  it("Bun's new session without a restore gets the workspace checkpoint (D-07 fallback)", async () => {
    ctx.state.link = { kind: "paused", frame: 1840 };
    const pending = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(srcWrites).toEqual([]);
    expect(ranIds()).toEqual(["game.bookmark", "game.restore", "game.pause"]);
    expect(toasts()).toEqual(["Game reloaded · state restored from the last checkpoint"]);
  });

  it("no new session within hotReloadWaitMs: workspace reloads the frame itself", async () => {
    const pending = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    await vi.advanceTimersByTimeAsync(1499);
    expect(srcWrites).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(srcWrites).toEqual([taggedGameUrl(ctx)]);

    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ranIds()).toEqual(["game.bookmark", "game.restore"]);
  });

  it("a bookmark lost to Bun's reload is no warn when the bridge restored the state", async () => {
    failOn("game.bookmark", "game page reloaded");
    const pending = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    ctx.link.attach({ ...manifestOf(COMMANDS), restored: RESTORE });
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ctx.log.warn).not.toHaveBeenCalled();
  });

  it("a bookmark lost to Bun's reload warns when nothing restored the state", async () => {
    failOn("game.bookmark", "game page reloaded");
    const pending = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: false, reason: "bookmark_failed" });
    expect(ctx.log.warn).toHaveBeenCalledWith("workspace:bookmark-failed", {
      message: "[moku-editor] game page reloaded"
    });
    expect(toasts()).toEqual(["Game reloaded"]);
    expect(srcWrites).toEqual([]);
  });

  it("without restore Bun's session only toasts Game reloaded", async () => {
    const pending = reloadFrame(ctx, { afterSave: true });
    await flush();
    ctx.link.attach(manifestOf());
    await expect(pending).resolves.toEqual({ restored: false });
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(toasts()).toEqual(["Game reloaded"]);
  });

  it("gameFrame().reload is the after-save reload: it waits for Bun", async () => {
    const pending = createGameFrame(ctx).reload({ restore: true });
    await flush();
    expect(srcWrites).toEqual([]);
    ctx.link.attach({ ...manifestOf(COMMANDS), restored: RESTORE });
    await expect(pending).resolves.toEqual({ restored: true });
  });

  it("a palette reload (no save) and hot reload off reload the frame at once", async () => {
    const palette = reloadFrame(ctx, { restore: true });
    await flush();
    expect(srcWrites).toHaveLength(1);
    ctx.link.attach(manifestOf(COMMANDS));
    await palette;

    ctx.link.hotReload.mockReturnValue({ hmr: false, owner: "bin" });
    const save = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    expect(srcWrites).toHaveLength(2);
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(save).resolves.toEqual({ restored: true });
  });

  it("a restored session that ends the D-07 wait is not restored again", async () => {
    ctx.link.hotReload.mockReturnValue(undefined);
    const pending = reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    expect(srcWrites).toHaveLength(1);
    ctx.link.attach({ ...manifestOf(COMMANDS), restored: RESTORE });
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ranIds()).toEqual(["game.bookmark"]);
    expect(toasts()).toEqual([RESTORED_TOAST]);
  });

  it("the run a call made during a save reload starts is an after-save run too", async () => {
    const first = reloadFrame(ctx, { restore: true, afterSave: true });
    void reloadFrame(ctx, { restore: true, afterSave: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await first;
    await flush();
    expect(ctx.state.frame.reload).toBeDefined();
    expect(srcWrites).toEqual([]);
  });
});

describe("reloadFrame with a checkpoint taken before (the Hot reload switch, D-32)", () => {
  const COMMANDS = ["game.bookmark", "game.restore"];
  const TAKEN: Taken = {
    checkpoint: { bookmark: { checkpoint: "before" }, paused: false },
    reason: undefined
  };

  it("restores that checkpoint and takes no new bookmark", async () => {
    const pending = reloadFrame(ctx, { restore: true }, TAKEN);
    await flush();
    expect(srcWrites).toHaveLength(1);
    ctx.link.attach(manifestOf(COMMANDS));
    await expect(pending).resolves.toEqual({ restored: true });
    expect(ranIds()).toEqual(["game.restore"]);
    expect(ctx.link.run).toHaveBeenCalledWith("game.restore", {
      bookmark: { checkpoint: "before" }
    });
  });

  it("the run a call made during it starts takes its own bookmark", async () => {
    const first = reloadFrame(ctx, { restore: true }, TAKEN);
    void reloadFrame(ctx, { restore: true });
    await flush();
    ctx.link.attach(manifestOf(COMMANDS));
    await first;
    await flush();
    expect(ranIds()).toEqual(["game.restore", "game.bookmark"]);
  });
});

describe("nextManifest", () => {
  it("resolves with this tab's next embedded manifest, not the one there now", async () => {
    const next = nextManifest(ctx, ctx.link, 15_000);
    const settled = settledOf(next);
    await flush();
    expect(settled()).toBe(false);
    const manifest = manifestOf(["game.restore"]);
    ctx.link.attach(manifest);
    await expect(next).resolves.toBe(manifest);
  });

  it("ends with undefined when its signal aborts, and stops listening", async () => {
    const cancel = new AbortController();
    const next = nextManifest(ctx, ctx.link, 15_000, cancel.signal);
    cancel.abort();
    await expect(next).resolves.toBeUndefined();
    expect(ctx.link.manifestListeners.size).toBe(0);
  });

  it("an aborted signal ends it at once", async () => {
    const cancel = new AbortController();
    cancel.abort();
    await expect(nextManifest(ctx, ctx.link, 15_000, cancel.signal)).resolves.toBeUndefined();
    expect(ctx.link.manifestListeners.size).toBe(0);
  });
});
