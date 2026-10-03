// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- Preact's "no props" */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPanelsApi } from "../../api";
import { definePanel } from "../../define";
import { createHandlers, handleLinkStatus, handleWorkspaceChanged } from "../../handlers";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Hooks: link:status fans out to every mounted panel; workspace:changed mounts
// a workspace lazily, only after start and only once.
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
  sources: { position: "game.position" },
  view: () => h("p", null, "flow")
});

const statePanel = definePanel({
  id: "state",
  title: "State",
  workspace: "state",
  sources: { model: "game.model" },
  view: () => h("p", null, "state")
});

describe("handleLinkStatus", () => {
  it("stores the status and calls setStatus on every mounted panel", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(flowPanel);
    api.register(statePanel);
    const flowHost = document.createElement("div");
    const stateHost = document.createElement("div");
    api.mountInto("flow", flowHost);
    api.mountInto("state", stateHost);

    const status = { kind: "silent", since: 5, lastFrame: 4 } as const;
    handleLinkStatus(ctx)({ status });
    expect(ctx.state.status).toEqual(status);
    expect(flowHost.querySelector<HTMLElement>("section")?.dataset.stale).toBe("silent");
    expect(stateHost.querySelector<HTMLElement>("section")?.dataset.stale).toBe("silent");
  });
});

describe("handleWorkspaceChanged", () => {
  it("does nothing before start", () => {
    const ctx = createCtx();
    createPanelsApi(ctx).register(statePanel);
    handleWorkspaceChanged(ctx)({ ws: "state" });
    expect(ctx.state.mounted.has("state")).toBe(false);
  });

  it("after start mounts the workspace into its host once", () => {
    const ctx = createCtx();
    createPanelsApi(ctx).register(statePanel);
    ctx.state.started = true;
    const handler = handleWorkspaceChanged(ctx);
    handler({ ws: "state" });
    const host = ctx.workspace.api.host("state");
    expect(ctx.state.mounted.get("state")?.element).toBe(host);
    expect(host.querySelectorAll("section[data-panel]")).toHaveLength(1);

    handler({ ws: "state" });
    expect(host.querySelectorAll("section[data-panel]")).toHaveLength(1);
    expect(ctx.link.watch).toHaveBeenCalledTimes(1);
  });
});

describe("createHandlers", () => {
  it("wires both hooks", () => {
    const ctx = createCtx();
    const hooks = createHandlers(ctx);
    hooks["link:status"]({ status: { kind: "empty" } });
    expect(ctx.state.status).toEqual({ kind: "empty" });
    expect(typeof hooks["workspace:changed"]).toBe("function");
  });
});
