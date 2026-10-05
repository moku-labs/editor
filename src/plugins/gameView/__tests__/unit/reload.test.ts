import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameFrame } from "../../../workspace/types";
import { onLinkStatus } from "../../handlers";
import { stopGameView } from "../../lifecycle";
import { isReloadBusy, reloadFromToolbar, reloadGame } from "../../stage/reload";
import { createCtx, flush, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// U11: the toolbar Reload is busy from the click until the reload settles, and
// while the link reports an expected reload from another trigger. A click while
// busy starts no second reload.
// ─────────────────────────────────────────────────────────────────────────────

/** A reload the test settles by hand. */
type Pending = { resolve(): void; reject(error: Error): void };

let ctx: TestCtx;

/**
 * Makes the next frame reload wait until the test settles it.
 *
 * @returns Settles the reload.
 */
function holdReload(): Pending {
  const pending: Pending = { resolve: () => undefined, reject: () => undefined };
  ctx.workspace.reload.mockImplementationOnce(
    () =>
      new Promise<Awaited<ReturnType<GameFrame["reload"]>>>((resolve, reject) => {
        pending.resolve = () => resolve({ restored: false });
        pending.reject = reject;
      })
  );
  return pending;
}

beforeEach(() => {
  ctx = createCtx();
});

afterEach(() => {
  stopGameView(ctx);
});

describe("reload busy state (U11)", () => {
  it("is idle at start", () => {
    expect(ctx.state.reloads).toBe(0);
    expect(ctx.state.link.reloading).toBe(false);
    expect(isReloadBusy(ctx.state)).toBe(false);
  });

  it("is busy from the start of a reload until it resolves, and notifies both ends", async () => {
    const pending = holdReload();
    let notified = 0;
    ctx.state.listeners.add(() => {
      notified += 1;
    });
    const done = reloadGame(ctx, false);
    expect(isReloadBusy(ctx.state)).toBe(true);
    expect(notified).toBe(1);

    pending.resolve();
    await done;
    expect(isReloadBusy(ctx.state)).toBe(false);
    expect(notified).toBe(2);
  });

  it("ends the busy state when the reload fails", async () => {
    const pending = holdReload();
    const done = reloadGame(ctx, true);
    expect(isReloadBusy(ctx.state)).toBe(true);
    pending.reject(new Error("frame gone"));
    await done;
    expect(isReloadBusy(ctx.state)).toBe(false);
    expect(ctx.log.warn).toHaveBeenCalledWith("gameView: reload failed", { message: "frame gone" });
  });

  it("a toolbar reload while one runs starts no second reload", async () => {
    const pending = holdReload();
    const first = reloadFromToolbar(ctx);
    await reloadFromToolbar(ctx);
    expect(ctx.workspace.reload).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.reload).toHaveBeenCalledWith({ restore: false });
    pending.resolve();
    await first;
    await reloadFromToolbar(ctx);
    expect(ctx.workspace.reload).toHaveBeenCalledTimes(2);
  });

  it("is busy while the link reports an expected reload from another trigger", async () => {
    const hook = onLinkStatus(ctx);
    hook({
      status: { kind: "lost", reason: "bye", lastFrame: 4, retryInMs: 1000, reloading: true },
      session: "s-1"
    });
    expect(ctx.state.link.reloading).toBe(true);
    expect(isReloadBusy(ctx.state)).toBe(true);
    await reloadFromToolbar(ctx);
    expect(ctx.workspace.reload).not.toHaveBeenCalled();

    hook({ status: { kind: "live", frame: 5 }, session: "s-1" });
    await flush();
    expect(ctx.state.link.reloading).toBe(false);
    expect(isReloadBusy(ctx.state)).toBe(false);
  });

  it("a real loss is not an expected reload", () => {
    onLinkStatus(ctx)({
      status: { kind: "lost", reason: "socket_closed", lastFrame: 4, retryInMs: 1000 }
    });
    expect(isReloadBusy(ctx.state)).toBe(false);
  });
});
