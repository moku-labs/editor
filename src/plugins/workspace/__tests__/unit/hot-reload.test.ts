import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  canSwitchHotReload,
  hotReloadTitle,
  refusalHint,
  setHotReload,
  toggleHotReload,
  watchHotReload
} from "../../hot-reload";
import { createCtx, flush, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The Hot reload switch (round 2 R6): the state comes from link.hotReload();
// Bun cannot switch HMR live, so a refused change says how to change it
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

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
  ctx = createCtx();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("refusalHint", () => {
  it("says how to change hot reload for each owner and direction", () => {
    expect(refusalHint({ hmr: true, owner: "bin" }, false)).toBe(
      "Start the bin with --no-hmr to turn hot reload off"
    );
    expect(refusalHint({ hmr: false, owner: "bin" }, true)).toBe(
      "Start the bin without --no-hmr to turn hot reload on"
    );
    expect(refusalHint({ hmr: false, owner: "server" }, true)).toBe(
      "The game's own server sets hot reload"
    );
    expect(refusalHint(undefined, true)).toBe("The editor server has not reported hot reload yet");
  });
});

describe("hotReloadTitle", () => {
  it("names the key, the state and who sets it", () => {
    expect(hotReloadTitle({ hmr: true, owner: "bin" }, undefined)).toBe(
      "Hot reload (H): on · Bun reloads the game after a save and keeps its state"
    );
    expect(hotReloadTitle({ hmr: false, owner: "bin" }, undefined)).toBe(
      "Hot reload (H): off · a save does not reload the game"
    );
    expect(hotReloadTitle({ hmr: false, owner: "server" }, undefined)).toBe(
      "Hot reload (H): off · the game's own server sets it"
    );
    expect(hotReloadTitle(undefined, undefined)).toBe(
      "Hot reload (H): waiting for the editor server"
    );
  });

  it("appends the hint of the last refusal", () => {
    expect(
      hotReloadTitle(
        { hmr: true, owner: "bin" },
        "Start the bin with --no-hmr to turn hot reload off"
      )
    ).toBe(
      "Hot reload (H): on · Bun reloads the game after a save and keeps its state · Start the bin with --no-hmr to turn hot reload off"
    );
  });
});

describe("canSwitchHotReload", () => {
  it("only the bin owns the switch", () => {
    expect(canSwitchHotReload({ hmr: true, owner: "bin" })).toBe(true);
    expect(canSwitchHotReload({ hmr: false, owner: "server" })).toBe(false);
    expect(canSwitchHotReload(undefined)).toBe(false);
  });
});

describe("setHotReload", () => {
  it("a refusal keeps the hint for the title, toasts it and resolves false", async () => {
    ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
    await expect(setHotReload(ctx, false)).resolves.toBe(false);
    expect(ctx.link.setHotReload).toHaveBeenCalledWith(false);
    expect(ctx.state.hotReloadNote).toBe("Start the bin with --no-hmr to turn hot reload off");
    expect(toasts()).toEqual(["Start the bin with --no-hmr to turn hot reload off"]);
  });

  it("an accepted change clears the hint and toasts the state", async () => {
    ctx.state.hotReloadNote = "old";
    ctx.link.setHotReload.mockResolvedValue(true);
    await expect(setHotReload(ctx, false)).resolves.toBe(true);
    expect(ctx.state.hotReloadNote).toBeUndefined();
    expect(toasts()).toEqual(["Hot reload off"]);
  });

  it("after stop it only reports the answer", async () => {
    ctx.state.stopped = true;
    await expect(setHotReload(ctx, false)).resolves.toBe(false);
    expect(ctx.state.hotReloadNote).toBeUndefined();
    expect(toasts()).toEqual([]);
  });
});

describe("toggleHotReload", () => {
  it("asks the bin for the other value", async () => {
    ctx.link.hotReload.mockReturnValue({ hmr: true, owner: "bin" });
    toggleHotReload(ctx);
    await flush();
    expect(ctx.link.setHotReload).toHaveBeenCalledWith(false);
  });

  it("a game's own server or an unknown state only toasts the hint", () => {
    ctx.link.hotReload.mockReturnValue({ hmr: false, owner: "server" });
    toggleHotReload(ctx);
    ctx.link.hotReload.mockReturnValue(undefined);
    toggleHotReload(ctx);
    expect(ctx.link.setHotReload).not.toHaveBeenCalled();
    expect(toasts()).toEqual([
      "The game's own server sets hot reload",
      "The editor server has not reported hot reload yet"
    ]);
  });
});

describe("watchHotReload", () => {
  it("re-renders on every state and forgets the last refusal", () => {
    let listener: ((state: { hmr: boolean; owner: "bin" | "server" }) => void) | undefined;
    const off = vi.fn();
    ctx.link.onHotReload.mockImplementation(fn => {
      listener = fn;
      return off;
    });
    const bump = vi.spyOn(ctx.state.ui, "bump");
    ctx.state.hotReloadNote = "Start the bin with --no-hmr to turn hot reload off";

    const stop = watchHotReload(ctx);
    listener?.({ hmr: false, owner: "bin" });
    expect(ctx.state.hotReloadNote).toBeUndefined();
    expect(bump).toHaveBeenCalledTimes(1);

    stop();
    expect(off).toHaveBeenCalledTimes(1);
  });
});
