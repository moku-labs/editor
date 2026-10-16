// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"navigation":{"disableChildFrameNavigation":true}}}
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SourceChange } from "../../../activeSource/types";
import type { SessionInfo } from "../../../registry/protocol";
import { createGameFrame, removeFrameLayer } from "../../frame/frame";
import { syncVeil } from "../../frame/veil";
import { createHandlers } from "../../handlers";
import { startWorkspace, stopWorkspace } from "../../lifecycle";
import {
  createCtx,
  deviceSessionOf,
  flush,
  IPHONE,
  ownSessionOf,
  type TestCtx,
  useDeviceSource
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// W11 the paused veil over the local game frame: only while a device is the
// source and activeSource paused the local preview; the warn text when the
// pause failed; repainted on activeSource:changed and on a sessions list.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

/**
 * The veil element in the frame overlay.
 *
 * @returns The element.
 */
function veil(): HTMLElement {
  const element = createGameFrame(ctx).overlay().querySelector<HTMLElement>("[data-frame-veil]");
  if (element === null) throw new Error("no veil");
  return element;
}

/**
 * Repaints the veil like the hook does.
 */
function repaint(): void {
  act(() => {
    syncVeil(ctx);
  });
}

/**
 * A source change to a device.
 *
 * @returns The change.
 */
function changeToDevice(): SourceChange {
  return {
    from: { kind: "local", session: "s-1" },
    to: ctx.source.currentValue,
    reason: "connected",
    at: 1
  };
}

beforeEach(() => {
  ctx = createCtx();
  ctx.link.sessionList = [ownSessionOf("s-1")];
  createGameFrame(ctx).overlay();
});

afterEach(() => {
  act(() => {
    removeFrameLayer(ctx.state);
  });
  document.body.innerHTML = "";
});

describe("the paused veil (W11)", () => {
  it("covers the local frame only while a device is the source and the preview is paused-by-source", () => {
    repaint();
    expect(veil().hidden).toBe(true);

    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    ctx.source.previewValue = { state: "paused-by-source" };
    repaint();
    expect(veil().hidden).toBe(false);
    expect(veil().dataset.tone).toBe("paused");
    expect(veil().textContent).toContain("Paused");
    expect(veil().textContent).toContain("Galaxy A26 is the source.");
    expect(veil().querySelector("button")?.textContent).toBe("Use local preview");

    // A preview the person had paused, or one still pausing, is not activeSource's pause.
    for (const state of ["held", "pausing", "running"] as const) {
      ctx.source.previewValue = { state };
      repaint();
      expect(veil().hidden).toBe(true);
    }
  });

  it("goes the moment the source is local again, while the resume is still in flight", () => {
    // Bug: "Paused — Local preview is the source" over a game that is about to run again.
    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    ctx.source.previewValue = { state: "paused-by-source" };
    repaint();
    expect(veil().hidden).toBe(false);

    ctx.source.currentValue = { kind: "local", session: "s-1" };
    repaint();
    expect(veil().hidden).toBe(true);
  });

  it("shows the warn text with the reason when the local preview could not be paused", () => {
    useDeviceSource(ctx, deviceSessionOf("s-9", IPHONE), "IPHONE15,4");
    ctx.source.previewValue = { state: "unpausable", reason: "game.pause is refused" };
    repaint();
    expect(veil().hidden).toBe(false);
    expect(veil().dataset.tone).toBe("warn");
    expect(veil().textContent).toContain("Could not pause the local preview");
    expect(veil().textContent).toContain("game.pause is refused");
  });

  it("Use local preview calls activeSource.useLocal; a failure is a warn", async () => {
    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    ctx.source.previewValue = { state: "paused-by-source" };
    repaint();
    act(() => veil().querySelector("button")?.click());
    expect(ctx.source.useLocal).toHaveBeenCalledOnce();

    ctx.source.useLocal.mockRejectedValueOnce(new Error("gone"));
    act(() => veil().querySelector("button")?.click());
    await flush();
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "workspace:use-local-failed",
      expect.objectContaining({ error: "Error: gone" })
    );
  });

  it("repaints on activeSource:changed", () => {
    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    ctx.source.previewValue = { state: "paused-by-source" };
    const hooks = createHandlers(ctx);
    const version = ctx.state.ui.version;

    act(() => hooks["activeSource:changed"](changeToDevice()));
    expect(veil().hidden).toBe(false);
    expect(ctx.state.ui.version).toBe(version + 1);
  });

  it("repaints on a sessions list (a pause taking hold after the change), until onStop", () => {
    let onSessions: ((list: readonly SessionInfo[]) => void) | undefined;
    const off = (): void => {
      onSessions = undefined;
    };
    ctx.link.onSessions.mockImplementation(listener => {
      onSessions = listener;
      return off;
    });
    startWorkspace(ctx);

    // A choice adopted from elsewhere: the change came first, the pause only now.
    useDeviceSource(ctx, deviceSessionOf("s-9"), "Galaxy A26");
    ctx.source.previewValue = { state: "paused-by-source" };
    const version = ctx.state.ui.version;
    act(() => onSessions?.(ctx.link.sessionList));
    expect(veil().hidden).toBe(false);
    expect(ctx.state.ui.version).toBe(version + 1);

    stopWorkspace(ctx);
    expect(onSessions).toBeUndefined();
  });

  it("a frame with no overlay yet has nothing to veil", () => {
    const bare = createCtx();
    expect(() => syncVeil(bare)).not.toThrow();
    expect(bare.state.frame.overlay).toBeUndefined();
  });
});
