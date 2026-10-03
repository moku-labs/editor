// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wireError } from "../../../registry/protocol";
import { gameUrl } from "../../frame/frame";
import { reloadFrame } from "../../frame/reload";
import { createCtx, flush, manifestOf, resultOf, type TestCtx } from "../helpers";

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
    expect(srcWrites).toEqual([gameUrl(ctx)]);

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
