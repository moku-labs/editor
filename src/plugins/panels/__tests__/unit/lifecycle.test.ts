// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- Preact's "no props" */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPanelsApi } from "../../api";
import { definePanel } from "../../define";
import { startPanels, stopPanels } from "../../lifecycle";
import { createCtx, manifestOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// onStart: mount the active workspace, one palette item per panel, manifest
// recheck, started. onStop: unmount everything, run cleanup.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const flowPanel = definePanel({
  id: "flow",
  title: "Flow",
  workspace: "flow",
  sources: { position: "game.position", graph: "game.graph" },
  view: () => h("p", null, "flow")
});

const statePanel = definePanel({
  id: "state",
  title: "State",
  workspace: "state",
  sources: { model: "game.model" },
  view: () => h("p", null, "state")
});

describe("startPanels", () => {
  it("mounts the active workspace, adds palette items, takes the link status, sets started", () => {
    const ctx = createCtx();
    ctx.link.current = { kind: "live", frame: 3 };
    const api = createPanelsApi(ctx);
    api.register(flowPanel);
    api.register(statePanel);

    startPanels(ctx);
    expect(ctx.state.started).toBe(true);
    expect(ctx.state.status).toEqual({ kind: "live", frame: 3 });
    expect(ctx.state.mounted.get("flow")?.element).toBe(ctx.workspace.api.host("flow"));
    expect(ctx.state.mounted.has("state")).toBe(false);
    expect(ctx.workspace.items.map(item => [item.id, item.group, item.label, item.hint])).toEqual([
      ["panel:flow", "Panels", "Flow", "Flow"],
      ["panel:state", "Panels", "State", "State"]
    ]);
    expect(ctx.link.listeners.size).toBe(1);
  });

  it("rechecks every mounted panel when the manifest changes", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(flowPanel);
    startPanels(ctx);
    expect(ctx.link.active()).toHaveLength(2);
    ctx.link.attach(manifestOf(["game.position"]));
    expect(ctx.link.active("game.graph")).toHaveLength(0);
    expect(ctx.state.mounted.get("flow")?.panels.get("flow")?.missing).toEqual(["game.graph"]);
  });
});

describe("stopPanels", () => {
  it("unmounts every panel (every unwatch), runs cleanup and clears mounted", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(flowPanel);
    api.register(statePanel);
    startPanels(ctx);
    api.mountInto("state", ctx.workspace.api.host("state"));
    expect(ctx.link.active()).toHaveLength(3);

    stopPanels({ state: ctx.state });
    expect(ctx.link.active()).toHaveLength(0);
    expect(ctx.link.listeners.size).toBe(0);
    for (const remove of ctx.workspace.removers) expect(remove).toHaveBeenCalledTimes(1);
    expect(ctx.state.mounted.size).toBe(0);
    expect(ctx.state.cleanup).toEqual([]);
    expect(ctx.state.started).toBe(false);
    expect(ctx.workspace.api.host("flow").querySelector("section")).toBeNull();
  });
});
