// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestHandler } from "../../../link/types";
import type { RelayedEditorMethod } from "../../../registry/protocol";
import {
  DEVICES,
  parseDeviceInfo,
  parseShowInfo,
  toWireValue,
  WORKSPACE_NAMES
} from "../../../registry/protocol";
import { initWorkspace, stopWorkspace } from "../../lifecycle";
import { addPrefsListener } from "../../prefs/apply";
import { answerDevice, answerShow, deviceInfoOf } from "../../requests";
import { CONFIG, createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The two editor-channel requests the hub relays to this page (D-60): `device`
// and `show`. An empty request reads; a request with a field goes the way of
// setDevice() and show(), so prefs are stored and workspace:changed fires.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  localStorage.clear();
  history.replaceState(history.state, "", "/__editor");
  ctx = createCtx();
});

afterEach(() => {
  stopWorkspace(ctx);
});

/**
 * The device of the stored preferences record.
 *
 * @returns The stored device, undefined while nothing was stored.
 */
function storedDevice(): unknown {
  const text = localStorage.getItem(CONFIG.storageKey);
  return typeof text === "string" ? JSON.parse(text).device : undefined;
}

/**
 * What a call throws.
 *
 * @param run - The call.
 * @returns The thrown value, undefined when it returned.
 */
function thrownBy(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  return undefined;
}

/**
 * The handler onInit gave link for a method. The mock of `handle` is typed by its last overload
 * (`select`), so the captured handler is read back as the handler of its own method.
 *
 * @param method - "device" or "show".
 * @returns The handler.
 */
function handlerOf<M extends RelayedEditorMethod>(method: M): RequestHandler<M> {
  const calls: readonly (readonly [string, unknown])[] = ctx.link.handle.mock.calls;
  const handler = calls.find(([name]) => name === method)?.[1];
  if (typeof handler !== "function") throw new Error(`link got no ${method} handler`);
  return handler as RequestHandler<M>;
}

describe("answerDevice", () => {
  it("an empty request reads the device and stores nothing", () => {
    const listener = vi.fn();
    addPrefsListener(ctx.state, listener);
    const version = ctx.state.ui.version;

    expect(answerDevice(ctx, {})).toMatchObject({
      preset: "iphone-18-pro",
      orientation: "portrait",
      folded: true,
      w: 402,
      h: 874
    });
    expect(storedDevice()).toBeUndefined();
    expect(listener).not.toHaveBeenCalled();
    expect(ctx.state.ui.version).toBe(version);
    expect(ctx.state.device).toEqual({ preset: "iphone-18-pro", orientation: "portrait" });
  });

  it("a preset change stores the prefs, tells onPrefs and answers the new viewport", () => {
    const listener = vi.fn();
    addPrefsListener(ctx.state, listener);

    expect(answerDevice(ctx, { preset: "pixel-8" })).toMatchObject({
      preset: "pixel-8",
      orientation: "portrait",
      folded: true,
      w: 412,
      h: 915
    });
    expect(storedDevice()).toEqual({ preset: "pixel-8", orientation: "portrait" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener.mock.calls[0]?.[0].device.preset.id).toBe("pixel-8");
  });

  it("landscape swaps w and h; the orientation alone keeps the preset", () => {
    expect(answerDevice(ctx, { preset: "pixel-8", orientation: "landscape" })).toMatchObject({
      preset: "pixel-8",
      orientation: "landscape",
      w: 915,
      h: 412
    });
    expect(storedDevice()).toEqual({ preset: "pixel-8", orientation: "landscape" });

    expect(answerDevice(ctx, { orientation: "portrait" })).toMatchObject({
      preset: "pixel-8",
      orientation: "portrait",
      w: 412,
      h: 915
    });
  });

  it("folded false on a foldable answers the inner screen, in landscape too", () => {
    expect(answerDevice(ctx, { preset: "galaxy-z-fold-6" })).toMatchObject({
      folded: true,
      w: 369,
      h: 905
    });
    expect(answerDevice(ctx, { folded: false })).toMatchObject({
      preset: "galaxy-z-fold-6",
      folded: false,
      w: 707,
      h: 823
    });
    expect(answerDevice(ctx, { orientation: "landscape" })).toMatchObject({
      folded: false,
      w: 823,
      h: 707
    });
    expect(storedDevice()).toEqual({
      preset: "galaxy-z-fold-6",
      orientation: "landscape",
      folded: false
    });
  });

  it("a new preset starts folded unless the request says otherwise, as setDevice does", () => {
    expect(answerDevice(ctx, { preset: "pixel-9-pro-fold", folded: false })).toMatchObject({
      folded: false,
      w: 791,
      h: 820
    });
    expect(answerDevice(ctx, { preset: "galaxy-z-fold-6" })).toMatchObject({
      folded: true,
      w: 369,
      h: 905
    });
  });

  it("answers folded true for a preset without a fold, whatever the flag", () => {
    expect(answerDevice(ctx, { preset: "pixel-8", folded: false })).toMatchObject({
      preset: "pixel-8",
      folded: true,
      w: 412,
      h: 915
    });
    expect(answerDevice(ctx, {}).folded).toBe(true);
  });

  it("an unknown preset throws -32602 naming the field, lists no ids and changes nothing", () => {
    answerDevice(ctx, { preset: "pixel-8" });
    const stored = localStorage.getItem(CONFIG.storageKey);
    const listener = vi.fn();
    addPrefsListener(ctx.state, listener);

    const error = thrownBy(() =>
      answerDevice(ctx, { preset: "nokia", orientation: "landscape", folded: false })
    );

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", retryable: false, field: "preset" }
    });
    const message = error instanceof Error ? error.message : "";
    expect(message).toMatch(/^\[moku-editor\] .*nokia/);
    for (const device of DEVICES) expect(message).not.toContain(device.id);

    expect(ctx.state.device).toEqual({ preset: "pixel-8", orientation: "portrait" });
    expect(localStorage.getItem(CONFIG.storageKey)).toBe(stored);
    expect(listener).not.toHaveBeenCalled();
  });

  it("lists every preset as a row of seven fields; a foldable row carries its cover screen", () => {
    const { presets } = answerDevice(ctx, { preset: "galaxy-z-fold-6", folded: false });

    expect(presets.map(row => row.id)).toEqual(DEVICES.map(device => device.id));
    expect(presets.find(row => row.id === "pixel-8")).toEqual({
      id: "pixel-8",
      name: "Pixel 8",
      group: "android",
      kind: "phone",
      w: 412,
      h: 915,
      foldable: false
    });
    expect(presets.find(row => row.id === "galaxy-z-fold-6")).toEqual({
      id: "galaxy-z-fold-6",
      name: "Galaxy Z Fold 6",
      group: "foldable",
      kind: "phone",
      w: 369,
      h: 905,
      foldable: true
    });
    expect(presets.filter(row => row.foldable).map(row => row.id)).toEqual([
      "galaxy-z-fold-6",
      "pixel-9-pro-fold",
      "iphone-duo"
    ]);
  });

  it("the answer passes the protocol's check of a DeviceInfo", () => {
    const info = answerDevice(ctx, { preset: "ipad-mini", orientation: "landscape" });
    expect(parseDeviceInfo(toWireValue(info))).toEqual(info);
  });
});

describe("deviceInfoOf", () => {
  it("builds the answer of a stored device: the screen in use, orientation applied", () => {
    const info = deviceInfoOf({ preset: "iphone-duo", orientation: "landscape", folded: false });

    expect(info).toMatchObject({
      preset: "iphone-duo",
      orientation: "landscape",
      folded: false,
      w: 626,
      h: 890
    });
    expect(info.presets).toHaveLength(21);
  });

  it("a stored record without the flag is folded", () => {
    expect(deviceInfoOf({ preset: "iphone-duo", orientation: "portrait" })).toMatchObject({
      folded: true,
      w: 466,
      h: 678
    });
  });
});

describe("answerShow", () => {
  it("a workspace name activates it and emits workspace:changed, as show() does", () => {
    expect(answerShow(ctx, { workspace: "state" })).toEqual({
      workspace: "state",
      workspaces: ["flow", "game", "render", "state", "files", "console"]
    });
    expect(ctx.state.active).toBe("state");
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:changed", { ws: "state" });
    expect(location.hash).toBe("#state");
  });

  it("an empty request only reads", () => {
    const version = ctx.state.ui.version;

    expect(answerShow(ctx, {})).toEqual({ workspace: "game", workspaces: WORKSPACE_NAMES });
    expect(ctx.state.active).toBe("game");
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(ctx.state.ui.version).toBe(version);
    expect(location.hash).toBe("");
  });

  it("the shown workspace again emits nothing and answers it", () => {
    answerShow(ctx, { workspace: "flow" });
    expect(answerShow(ctx, { workspace: "flow" }).workspace).toBe("flow");
    expect(ctx.emit).toHaveBeenCalledTimes(1);
  });

  it("the answer passes the protocol's check of a ShowInfo", () => {
    const info = answerShow(ctx, { workspace: "console" });
    expect(parseShowInfo(toWireValue(info))).toEqual(info);
  });
});

describe("the handlers of link", () => {
  it("onInit hands link the device and the show handler", () => {
    initWorkspace(ctx);
    const methods: readonly string[] = ctx.link.handle.mock.calls.map(([method]) => method);
    expect(methods).toEqual(["device", "show"]);
  });

  it("the device handler of link changes the device and answers it", async () => {
    initWorkspace(ctx);
    const info = await handlerOf("device")({ preset: "pixel-8", orientation: "landscape" });

    expect(info).toMatchObject({ preset: "pixel-8", orientation: "landscape", w: 915, h: 412 });
    expect(storedDevice()).toEqual({ preset: "pixel-8", orientation: "landscape" });
  });

  it("the show handler of link shows the workspace and answers it", async () => {
    initWorkspace(ctx);
    const info = await handlerOf("show")({ workspace: "render" });

    expect(info).toEqual({ workspace: "render", workspaces: WORKSPACE_NAMES });
    expect(ctx.emit).toHaveBeenCalledWith("workspace:changed", { ws: "render" });
  });

  it("onStop removes both handlers", () => {
    initWorkspace(ctx);
    const removers = ctx.link.handle.mock.results.map(result => result.value);
    expect(removers).toHaveLength(2);

    stopWorkspace(ctx);
    for (const remove of removers) expect(remove).toHaveBeenCalledTimes(1);
  });
});
