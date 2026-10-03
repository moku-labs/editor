// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createWorkspaceApi } from "../../api";
import { DEVICES } from "../../devices";
import { stopWorkspace } from "../../lifecycle";
import type { WorkspaceApi } from "../../types";
import { createCtx, flush, manifestOf, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The workspace api (`app.workspace`, `tools.workspace`)
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let api: WorkspaceApi;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  history.replaceState(history.state, "", "/__editor");
  ctx = createCtx();
  api = createWorkspaceApi(ctx);
});

afterEach(() => {
  stopWorkspace(ctx);
  vi.useRealTimers();
  document.body.innerHTML = "";
  delete document.documentElement.dataset.theme;
});

describe("active / show", () => {
  it("show emits workspace:changed once and writes the hash", () => {
    expect(api.active()).toBe("flow");
    api.show("game");
    expect(api.active()).toBe("game");
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:changed", { ws: "game" });
    expect(location.hash).toBe("#game");
  });

  it("show un-hides the new host before the re-render, so the preview measures a shown host", () => {
    const flow = api.host("flow");
    const render = api.host("render");
    expect(render.hidden).toBe(true);
    api.show("render");
    expect(render.hidden).toBe(false);
    expect(flow.hidden).toBe(true);
  });

  it("showing the shown workspace emits nothing", () => {
    api.show("flow");
    expect(ctx.emit).not.toHaveBeenCalled();
  });

  it("rejects an unknown workspace with a [moku-editor] error", () => {
    // @ts-expect-error — not a WorkspaceId
    expect(() => api.show("nope")).toThrow(/^\[moku-editor\] Unknown workspace "nope"\./);
  });
});

describe("theme / setTheme", () => {
  it("toggles from the OS theme, persists the choice and sets data-theme", () => {
    const seen: string[] = [];
    api.onPrefs(prefs => seen.push(prefs.theme));
    expect(api.theme()).toBe("light");

    api.setTheme();
    expect(api.theme()).toBe("dark");
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(JSON.parse(localStorage.getItem("moku-editor-test") ?? "{}").theme).toBe("dark");

    api.setTheme("dark");
    api.setTheme();
    expect(api.theme()).toBe("light");
    expect(seen).toEqual(["dark", "dark", "light"]);
  });
});

describe("preview / setPreview", () => {
  it("answers the prefs plus the float size", () => {
    expect(api.preview("flow")).toEqual({
      visible: true,
      size: "S",
      corner: "bottom-right",
      width: 150,
      height: 280
    });
  });

  it("patches, persists and toasts a visibility change naming the workspace", () => {
    api.setPreview("render", { visible: false });
    expect(api.preview("render").visible).toBe(false);
    expect(ctx.state.toasts.at(-1)?.message).toBe(
      "Game preview hidden in Render · remembered for this workspace"
    );
    const stored = JSON.parse(localStorage.getItem("moku-editor-test") ?? "{}");
    expect(stored.previews.render.visible).toBe(false);

    api.setPreview("render", { visible: true, size: "L" });
    expect(api.preview("render")).toMatchObject({ size: "L", width: 340, height: 660 });
    expect(ctx.state.toasts.at(-1)?.message).toBe(
      "Game preview shown in Render · remembered for this workspace"
    );
  });

  it("a size or corner change does not toast", () => {
    api.setPreview("files", { size: "M", corner: "top-left" });
    expect(ctx.state.toasts).toEqual([]);
    expect(api.preview("files")).toMatchObject({ size: "M", corner: "top-left" });
  });
});

describe("device / setDevice / devices", () => {
  it("device() returns the DeviceSpec and the orientation", () => {
    expect(api.device()).toEqual({ preset: DEVICES[1], orientation: "portrait" });
    expect(api.device().preset.w).toBe(393);
    expect(api.devices()).toBe(DEVICES);
  });

  it("setDevice patches, persists and notifies onPrefs", () => {
    const listener = vi.fn();
    const off = api.onPrefs(listener);
    api.setDevice({ orientation: "landscape" });
    api.setDevice({ preset: "ipad-mini" });
    expect(api.device()).toEqual({ preset: DEVICES[4], orientation: "landscape" });
    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener.mock.calls[1]?.[0].device.preset.id).toBe("ipad-mini");
    const stored = JSON.parse(localStorage.getItem("moku-editor-test") ?? "{}");
    expect(stored.device).toEqual({ preset: "ipad-mini", orientation: "landscape" });

    off();
    api.setDevice({ orientation: "portrait" });
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("rejects an unknown preset with a [moku-editor] error", () => {
    // @ts-expect-error — not a DevicePresetId
    expect(() => api.setDevice({ preset: "nokia" })).toThrow(/^\[moku-editor\] Unknown device/);
  });

  it("a listener that throws is logged and the others still run", () => {
    const after = vi.fn();
    api.onPrefs(() => {
      throw new Error("bad listener");
    });
    api.onPrefs(after);
    api.setTheme("dark");
    expect(after).toHaveBeenCalledTimes(1);
    expect(ctx.log.error).toHaveBeenCalledWith(
      "workspace:prefs-listener-failed",
      {},
      new Error("bad listener")
    );
  });
});

describe("host / mount", () => {
  it("host(ws) is one element per workspace, created before mount and kept after it", () => {
    const flow = api.host("flow");
    expect(flow.tagName).toBe("SECTION");
    expect(flow.dataset.workspaceHost).toBe("flow");
    expect(flow.getAttribute("aria-label")).toBe("Flow");
    expect(flow.hidden).toBe(false);
    expect(api.host("console").hidden).toBe(true);
    expect(api.host("flow")).toBe(flow);

    const root = document.createElement("div");
    document.body.append(root);
    api.mount(root);
    expect(api.host("flow")).toBe(flow);
    expect(root.contains(flow)).toBe(true);
    expect(flow.hidden).toBe(false);
    expect(api.host("console").hidden).toBe(true);
  });
});

describe("badge", () => {
  it("sets and clears a rail badge", () => {
    const version = ctx.state.ui.version;
    api.badge("console", { count: 3, tone: "error", label: "2 warn · 1 error" });
    expect(ctx.state.badges.console).toEqual({
      count: 3,
      tone: "error",
      label: "2 warn · 1 error"
    });
    api.badge("console", undefined);
    expect(ctx.state.badges.console).toBeUndefined();
    expect(ctx.state.ui.version).toBe(version + 2);
  });
});

describe("palette / toast / keys", () => {
  it("palette.add and palette.open reach the palette state", () => {
    const remove = api.palette.add({ id: "node:a", group: "Nodes", label: "a", run: vi.fn() });
    expect(ctx.state.palette.items.has("node:a")).toBe(true);
    api.palette.open("merge");
    expect(ctx.state.palette).toMatchObject({ open: true, query: "merge" });
    remove();
    expect(ctx.state.palette.items.has("node:a")).toBe(false);
  });

  it("toast shows a message with an optional file", () => {
    api.toast("✓ Note saved", ".moku/notes/a.md");
    expect(ctx.state.toasts[0]).toMatchObject({
      message: "✓ Note saved",
      file: ".moku/notes/a.md"
    });
  });

  it("keys.bind and keys.escape register and return removers", () => {
    const off = api.keys.bind({ keys: "n", label: "Note", run: vi.fn(), workspace: "flow" });
    const close = api.keys.escape("noteEditor", () => true);
    expect(ctx.state.keys.bindings).toHaveLength(1);
    expect(ctx.state.keys.escape).toHaveLength(1);
    off();
    close();
    expect(ctx.state.keys.bindings).toHaveLength(0);
    expect(ctx.state.keys.escape).toHaveLength(0);
  });
});

describe("overlay in game", () => {
  it("overlayInGame reads the flag; setOverlayInGame runs editor.overlay with origin panel", async () => {
    ctx.state.link = { kind: "live", frame: 1 };
    ctx.link.manifestValue = manifestOf();
    expect(api.overlayInGame()).toBe(false);
    await api.setOverlayInGame(true);
    expect(api.overlayInGame()).toBe(true);
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "editor.overlay", origin: "panel" })
    );
  });
});

describe("gameFrame / previewZone", () => {
  it("one GameFrame object; no box before mount; reload resolves not_mounted", async () => {
    const frame = api.gameFrame();
    expect(api.gameFrame()).toBe(frame);
    expect(frame.url).toBe(new URL("/game/", location.href).href);
    expect(frame.box()).toBeUndefined();
    expect(frame.overlay().dataset.frameOverlay).toBe("");
    await expect(frame.reload()).resolves.toEqual({ restored: false, reason: "not_mounted" });
  });

  it("previewZone stores a zone per workspace; the remover drops it", () => {
    const zone = document.createElement("div");
    const remove = api.previewZone("flow", zone, { bottom: 40 });
    expect(ctx.state.frame.zones.get("flow")).toEqual({ element: zone, insets: { bottom: 40 } });
    remove();
    expect(ctx.state.frame.zones.has("flow")).toBe(false);
  });

  it("an older zone remover leaves a newer zone alone", () => {
    const remove = api.previewZone("flow", document.createElement("div"));
    const newer = document.createElement("div");
    api.previewZone("flow", newer);
    remove();
    expect(ctx.state.frame.zones.get("flow")?.element).toBe(newer);
  });

  it("dock places the frame over a stage slot once mounted", async () => {
    const root = document.createElement("div");
    document.body.append(root);
    api.mount(root);
    api.show("game");
    const slot = document.createElement("div");
    const release = api.gameFrame().dock(slot, { fit: "fit" });
    expect(api.gameFrame().box()?.docked).toBe("stage");
    release();
    expect(api.gameFrame().box()?.docked).toBe("hidden");
    await flush();
  });
});
