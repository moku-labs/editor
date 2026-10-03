import { describe, expect, it } from "vitest";
import { wireError } from "../../../registry/protocol";
import { overlayAvailable, reapplyOverlay, setOverlayInGame } from "../../overlay";
import { createCtx, flush, manifestOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The overlay-in-game switch (R4): runs editor.overlay, toasts, reverts on
// failure, keeps the flag while disconnected, re-applies on new sessions
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A ctx with a live link whose manifest lists editor.overlay.
 *
 * @returns The ctx.
 */
function liveCtx() {
  const ctx = createCtx();
  ctx.state.link = { kind: "live", frame: 10 };
  ctx.link.current = { kind: "live", frame: 10 };
  ctx.link.manifestValue = manifestOf();
  return ctx;
}

describe("overlayAvailable", () => {
  it("needs a live or paused link and editor.overlay in the manifest", () => {
    const ctx = liveCtx();
    expect(overlayAvailable(ctx)).toBe(true);
    ctx.state.link = { kind: "paused", frame: 3 };
    expect(overlayAvailable(ctx)).toBe(true);
    ctx.state.link = { kind: "silent", since: 0, lastFrame: 3 };
    expect(overlayAvailable(ctx)).toBe(false);
    ctx.state.link = { kind: "live", frame: 3 };
    ctx.link.manifestValue = manifestOf(["game.step"]);
    expect(overlayAvailable(ctx)).toBe(false);
  });
});

describe("setOverlayInGame", () => {
  it("runs editor.overlay through runCommand and toasts on", async () => {
    const ctx = liveCtx();
    await setOverlayInGame(ctx, true, "topbar");

    expect(ctx.state.overlayInGame).toBe(true);
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { on: true });
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "editor.overlay", origin: "topbar", ok: true })
    );
    expect(ctx.state.toasts.map(toast => toast.message)).toEqual(["Overlay in game on"]);
  });

  it("toasts off when switched off", async () => {
    const ctx = liveCtx();
    ctx.state.overlayInGame = true;
    await setOverlayInGame(ctx, false, "key");
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { on: false });
    expect(ctx.state.toasts.at(-1)?.message).toBe("Overlay in game off");
  });

  it("a failure reverts the flag, toasts the bare message and warns with the code", async () => {
    const ctx = liveCtx();
    ctx.link.run.mockRejectedValue(wireError(-32_000, "overlay crashed"));
    await setOverlayInGame(ctx, true, "panel");

    expect(ctx.state.overlayInGame).toBe(false);
    expect(ctx.state.toasts.at(-1)?.message).toBe("Overlay in game failed · overlay crashed");
    expect(ctx.log.warn).toHaveBeenCalledWith("workspace:overlay-failed", { code: -32_000 });
  });

  it("not connected keeps the flag for the next session without a run or a toast", async () => {
    const ctx = createCtx();
    await setOverlayInGame(ctx, true, "topbar");
    expect(ctx.state.overlayInGame).toBe(true);
    expect(ctx.link.run).not.toHaveBeenCalled();
    expect(ctx.state.toasts).toEqual([]);
  });
});

describe("reapplyOverlay", () => {
  it("re-runs { on: true } for a new manifest while the flag is on, without workspace:ran", async () => {
    const ctx = createCtx();
    ctx.state.overlayInGame = true;
    reapplyOverlay(ctx, manifestOf());
    await flush();
    expect(ctx.link.run).toHaveBeenCalledWith("editor.overlay", { on: true });
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.state.toasts).toEqual([]);
  });

  it("does nothing while off, without a manifest or without editor.overlay", async () => {
    const ctx = createCtx();
    reapplyOverlay(ctx, manifestOf());
    ctx.state.overlayInGame = true;
    reapplyOverlay(ctx, undefined);
    reapplyOverlay(ctx, manifestOf(["game.step"]));
    await flush();
    expect(ctx.link.run).not.toHaveBeenCalled();
  });

  it("a failed re-apply is a warn only", async () => {
    const ctx = createCtx();
    ctx.state.overlayInGame = true;
    ctx.link.run.mockRejectedValue(wireError(-32_001, "reloaded"));
    reapplyOverlay(ctx, manifestOf());
    await flush();
    expect(ctx.log.warn).toHaveBeenCalledWith("workspace:overlay-failed", { code: -32_001 });
    expect(ctx.state.overlayInGame).toBe(true);
  });
});
