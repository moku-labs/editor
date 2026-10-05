// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- Preact's "no props" */
import { h } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceId } from "../../../workspace/types";
import { createPanelsApi } from "../../api";
import { definePanel } from "../../shared/define";
import type { PanelSpec } from "../../types";
import { createCtx, flush, resultOf } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// createPanelsApi: register, list, mountInto, run — over a mock link and
// workspace; requestAnimationFrame runs the render at once.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/**
 * A panel without sources that prints its id.
 *
 * @param id - Panel id.
 * @param workspace - Its workspace.
 * @returns The spec.
 */
function panelOf(id: string, workspace: WorkspaceId = "flow"): PanelSpec {
  return definePanel({
    id,
    title: `Title ${id}`,
    workspace,
    sources: {},
    view: () => h("p", null, id)
  });
}

/**
 * The panel ids mounted in an element, in DOM order.
 *
 * @param element - The element.
 * @returns The ids.
 */
function idsIn(element: HTMLElement): string[] {
  return [...element.querySelectorAll<HTMLElement>("section[data-panel]")].map(
    section => section.dataset.panel ?? ""
  );
}

describe("register and list", () => {
  it("lists panels in registration order and returns a copy", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(panelOf("flow"));
    api.register(panelOf("state", "state"));
    const list = api.list();
    expect(list.map(panel => panel.id)).toEqual(["flow", "state"]);
    (list as PanelSpec[]).pop();
    expect(api.list()).toHaveLength(2);
  });

  it("throws on a duplicate id", () => {
    const api = createPanelsApi(createCtx());
    api.register(panelOf("flow"));
    expect(() => api.register(panelOf("flow"))).toThrow(
      '[moku-editor] Panel "flow" is already registered.\n  Give every panel its own id.'
    );
    expect(api.list()).toHaveLength(1);
  });

  it("after start, a panel of a mounted workspace mounts at once and gets a palette item", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(panelOf("flow"));
    const element = document.createElement("div");
    api.mountInto("flow", element);
    ctx.state.started = true;

    api.register(panelOf("flow.history"));
    expect(idsIn(element)).toEqual(["flow", "flow.history"]);
    expect(ctx.workspace.items.map(item => [item.group, item.label, item.hint])).toEqual([
      ["Panels", "Title flow.history", "Flow"]
    ]);
    expect(ctx.state.cleanup).toHaveLength(1);

    api.register(panelOf("state", "state"));
    expect(idsIn(element)).toEqual(["flow", "flow.history"]);
    expect(ctx.state.mounted.has("state")).toBe(false);
  });

  it("before start, register neither mounts nor adds a palette item", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    const element = document.createElement("div");
    api.mountInto("flow", element);
    api.register(panelOf("flow"));
    expect(idsIn(element)).toEqual([]);
    expect(ctx.workspace.items).toEqual([]);
  });

  it("a palette item shows the workspace, then focuses the panel's section", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    ctx.state.started = true;
    const host = ctx.workspace.api.host("state");
    document.body.append(host);
    ctx.workspace.onShow = ws => api.mountInto(ws, ctx.workspace.api.host(ws));
    api.register(panelOf("state", "state"));

    ctx.workspace.items[0]?.run();
    expect(ctx.workspace.api.show).toHaveBeenCalledWith("state");
    expect(document.activeElement).toBe(host.querySelector("section[data-panel='state']"));
  });
});

describe("mountInto", () => {
  it("mounts only the workspace's panels, in registration order", () => {
    const api = createPanelsApi(createCtx());
    api.register(panelOf("flow"));
    api.register(panelOf("state", "state"));
    api.register(panelOf("flow.inspector"));
    const element = document.createElement("div");
    api.mountInto("flow", element);
    expect(idsIn(element)).toEqual(["flow", "flow.inspector"]);
    expect(element.textContent).toBe("flowflow.inspector");
  });

  it("is idempotent for the same element", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(panelOf("flow"));
    const element = document.createElement("div");
    const first = api.mountInto("flow", element);
    const second = api.mountInto("flow", element);
    expect(idsIn(element)).toEqual(["flow"]);
    expect(typeof second).toBe("function");
    first();
    expect(idsIn(element)).toEqual([]);
  });

  it("moves the mount to a different element and unwatches the old one", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(
      definePanel({
        id: "flow",
        title: "Flow",
        workspace: "flow",
        sources: { position: "game.position" },
        view: () => h("p", null)
      })
    );
    const first = document.createElement("div");
    const second = document.createElement("div");
    const unmountFirst = api.mountInto("flow", first);
    api.mountInto("flow", second);
    expect(idsIn(first)).toEqual([]);
    expect(idsIn(second)).toEqual(["flow"]);
    expect(ctx.link.active("game.position")).toHaveLength(1);
    expect(ctx.state.mounted.get("flow")?.element).toBe(second);

    unmountFirst();
    expect(idsIn(second)).toEqual(["flow"]);
  });

  it("the returned unmount removes every section, unwatches and forgets the workspace", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(
      definePanel({
        id: "flow",
        title: "Flow",
        workspace: "flow",
        sources: { position: "game.position" },
        view: () => h("p", null)
      })
    );
    const element = document.createElement("div");
    const unmount = api.mountInto("flow", element);
    unmount();
    expect(idsIn(element)).toEqual([]);
    expect(ctx.link.active()).toHaveLength(0);
    expect(ctx.state.mounted.has("flow")).toBe(false);
    unmount();
  });

  it("mounting into a detached host works and the content is there once it is attached", () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    api.register(panelOf("flow"));
    const host = ctx.workspace.api.host("flow");
    api.mountInto("flow", host);
    expect(host.isConnected).toBe(false);
    document.body.append(host);
    expect(document.querySelector("section[data-panel='flow']")?.textContent).toBe("flow");
  });

  it("starts the panels with the stored link status", () => {
    const ctx = createCtx();
    ctx.state.status = { kind: "lost", reason: "socket_closed", lastFrame: 0, retryInMs: 1000 };
    const api = createPanelsApi(ctx);
    api.register(
      definePanel({
        id: "flow",
        title: "Flow",
        workspace: "flow",
        sources: { position: "game.position" },
        view: () => h("p", null)
      })
    );
    const element = document.createElement("div");
    api.mountInto("flow", element);
    expect(element.querySelector<HTMLElement>("section")?.dataset.panelState).toBe("no-game");
  });
});

describe("run (R9)", () => {
  it("with no panel mounted calls link.run once and emits workspace:ran origin panel by default", async () => {
    const ctx = createCtx();
    ctx.link.run.mockResolvedValue(resultOf(7));
    const api = createPanelsApi(ctx);
    await expect(api.run("game.step", { frames: 1 })).resolves.toEqual(resultOf(7));
    expect(ctx.link.run).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.step", input: { frames: 1 }, origin: "panel", ok: true })
    );
  });

  it("uses the given origin", async () => {
    const ctx = createCtx();
    const api = createPanelsApi(ctx);
    await api.run("game.pause", undefined, "key");
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.pause", input: undefined, origin: "key" })
    );
  });

  it("a rejection emits ok: false and still rejects", async () => {
    const ctx = createCtx();
    const failure = new Error("[moku-editor] timeout");
    ctx.link.run.mockRejectedValue(failure);
    const api = createPanelsApi(ctx);
    await expect(api.run("game.capture", undefined, "palette")).rejects.toBe(failure);
    await flush();
    expect(ctx.emit).toHaveBeenCalledWith(
      "workspace:ran",
      expect.objectContaining({ id: "game.capture", origin: "palette", ok: false })
    );
  });
});
