// @vitest-environment happy-dom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";
import { WORKSPACE_IDS, WORKSPACE_LABELS } from "../../ids";
import { createWorkspaceState, trackCleanup } from "../../state";
import { createUiStore, useWorkspace } from "../../ui/store";
import { isPreviewWorkspace, isWorkspaceId, PREVIEW_WORKSPACES } from "../../workspaces";
import { CONFIG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Initial state, cleanup tracking, the UI store and the workspace constants
// ─────────────────────────────────────────────────────────────────────────────

describe("createWorkspaceState", () => {
  it("starts at defaultWorkspace with defaults, empty maps and connecting", () => {
    const state = createWorkspaceState({ config: { ...CONFIG, defaultWorkspace: "files" } });
    expect(state.active).toBe("files");
    expect(state.theme).toEqual({ chosen: undefined, os: "light" });
    expect(state.previews.console).toEqual({ visible: true, size: "S", corner: "bottom-right" });
    expect(state.device).toEqual({ preset: "iphone-18-pro", orientation: "portrait" });
    expect(state.muted).toBe(false);
    expect(state.overlayInGame).toBe(false);
    expect(state.reference).toBe(false);
    expect(state.showTaps).toBe(true);
    expect(state.taps).toEqual([]);
    expect(state.density).toEqual({ chosen: "auto", applied: "comfortable" });
    expect(state.link).toEqual({ kind: "connecting" });
    expect(state.everLive).toBe(false);
    expect(state.toasts).toEqual([]);
    expect(state.nextToastId).toBe(1);
    expect(state.palette).toEqual({ open: false, query: "", index: 0, items: new Map() });
    expect(state.frame.iframe).toBeUndefined();
    expect(state.frame.zones.size).toBe(0);
    expect(state.dom.hosts.size).toBe(0);
    expect(state.ui.version).toBe(0);
    expect(state.stopped).toBe(false);
  });

  it("gives each state its own previews record", () => {
    const one = createWorkspaceState({ config: CONFIG });
    const two = createWorkspaceState({ config: CONFIG });
    one.previews.flow.visible = false;
    expect(two.previews.flow.visible).toBe(true);
  });
});

describe("trackCleanup", () => {
  it("adds a cleanup and returns an untrack that removes it without running it", () => {
    const state = createWorkspaceState({ config: CONFIG });
    const cleanup = vi.fn();
    const untrack = trackCleanup(state, cleanup);
    expect(state.dom.cleanup).toEqual([cleanup]);
    untrack();
    untrack();
    expect(state.dom.cleanup).toEqual([]);
    expect(cleanup).not.toHaveBeenCalled();
  });
});

describe("createUiStore", () => {
  it("bumps the version and calls subscribers until they unsubscribe", () => {
    const store = createUiStore();
    const fn = vi.fn();
    const off = store.subscribe(fn);
    store.bump();
    expect(store.version).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
    off();
    store.bump();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("useWorkspace", () => {
  it("re-renders a component on every bump and reads the selector", () => {
    const store = createUiStore();
    let value = "a";
    const Probe = () =>
      h(
        "p",
        { "data-probe": "" },
        useWorkspace(store, () => value)
      );
    const root = document.createElement("div");
    act(() => {
      render(h(Probe, {}), root);
    });
    expect(root.textContent).toBe("a");

    value = "b";
    act(() => {
      store.bump();
    });
    expect(root.textContent).toBe("b");

    act(() => {
      render(undefined, root);
    });
    act(() => {
      store.bump();
    });
    expect(root.textContent).toBe("");
  });
});

describe("workspaces", () => {
  it("lists the six workspaces with Game first, the five preview workspaces and their labels", () => {
    expect(WORKSPACE_IDS).toEqual(["game", "flow", "render", "state", "files", "console"]);
    expect(PREVIEW_WORKSPACES).toEqual(["flow", "render", "state", "files", "console"]);
    expect(WORKSPACE_LABELS.console).toBe("Console");
    expect(isWorkspaceId("game")).toBe(true);
    expect(isWorkspaceId("nope")).toBe(false);
    expect(isWorkspaceId(7)).toBe(false);
    expect(isPreviewWorkspace("game")).toBe(false);
    expect(isPreviewWorkspace("render")).toBe(true);
  });
});
