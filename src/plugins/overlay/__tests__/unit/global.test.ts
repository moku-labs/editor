// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { startOverlayWith } from "../../lifecycle";
import type { OverlayChannel } from "../../types";
import { createOctx, started, stopped } from "../helpers";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__MOKU_GAME_OVERLAY__");
});

/**
 * The global channel now.
 *
 * @returns The channel.
 */
function channel(): OverlayChannel {
  const value = globalThis.__MOKU_GAME_OVERLAY__;
  if (value === undefined) throw new Error("no channel");
  return value;
}

describe("globalThis.__MOKU_GAME_OVERLAY__", () => {
  it("the global is missing between start and the first open (it is set at start)", () => {
    const octx = started(createOctx());
    expect(channel()).toBe(octx.state.channel);
    expect(channel().isOpen()).toBe(false);
    stopped(octx);
    expect(globalThis.__MOKU_GAME_OVERLAY__).toBeUndefined();
  });

  it("open({ mode: 'x' }) does nothing (an unknown mode opens the card)", () => {
    const octx = started(createOctx());
    Reflect.apply(channel().open, undefined, [{ mode: "x" }]);
    expect(octx.state.mode).toBe("card");
    channel().open({ mode: "pill" });
    expect(octx.state.mode).toBe("pill");
    channel().close();
    channel().open();
    expect(octx.state.mode).toBe("card");
    channel().toggle();
    expect(channel().isOpen()).toBe(false);
    stopped(octx);
  });

  it("onStop deletes another agent's channel (it keeps it)", () => {
    const octx = started(createOctx());
    const other: OverlayChannel = {
      open: () => undefined,
      close: () => undefined,
      toggle: () => undefined,
      isOpen: () => true
    };
    globalThis.__MOKU_GAME_OVERLAY__ = other;
    stopped(octx);
    expect(globalThis.__MOKU_GAME_OVERLAY__).toBe(other);
  });

  it("is not set without a document", () => {
    const octx = createOctx();
    startOverlayWith(octx, false, undefined);
    expect(globalThis.__MOKU_GAME_OVERLAY__).toBeUndefined();
    expect(octx.log.warn).toHaveBeenCalledWith("overlay:no-dom");
  });
});
