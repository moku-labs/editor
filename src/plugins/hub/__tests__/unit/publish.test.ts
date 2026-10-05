import { describe, expect, it } from "vitest";
import type { SelectionInfo } from "../../../registry/protocol";
import { createHubApi } from "../../api";
import { createCtx, createHarness, fakeSocket, paramsOf } from "../helpers";

/** An area selection: its readonly items keep it from being Json, so publish converts it. */
const AREA: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  name: "area",
  type: "area",
  rect: { x: 0, y: 30, w: 200, h: 60 },
  area: { x: 0, y: 30, w: 200, h: 60 },
  items: [{ ref: { kind: "ui", path: "column#0/hudRow/coins" }, name: "coins", type: "text" }],
  at: 1_790_000_000_000
};

// ─────────────────────────────────────────────────────────────────────────────
// hub.publish (R6): server state pushed to every tools page, kept, and replayed
// right after the sessions list of each tools connection that opens later.
// ─────────────────────────────────────────────────────────────────────────────

describe("hub.publish", () => {
  it("sends editor.hotReload to every tools socket, never to an agent", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const first = harness.connect("tools");
    const second = harness.connect("tools");
    first.clear();
    second.clear();
    const api = createHubApi(harness.ctx);

    api.publish("hotReload", { hmr: true, owner: "bin" });

    for (const tools of [first, second]) {
      const notes = tools.notes("editor", "hotReload");
      expect(notes).toHaveLength(1);
      expect(paramsOf(notes[0])).toEqual({ hmr: true, owner: "bin" });
      expect(notes[0]).not.toHaveProperty("session");
    }
    expect(agent.notes("editor", "hotReload")).toEqual([]);
  });

  it("is sent while a tools socket is congested (state is never dropped)", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    harness.toolsConn(tools).congested = true;
    tools.clear();

    createHubApi(harness.ctx).publish("hotReload", { hmr: false, owner: "server" });

    expect(paramsOf(tools.notes("editor", "hotReload")[0])).toEqual({
      hmr: false,
      owner: "server"
    });
  });

  it("replays the last value right after the sessions list of a tools socket that opens", () => {
    const harness = createHarness();
    const api = createHubApi(harness.ctx);
    api.publish("hotReload", { hmr: true, owner: "bin" });
    api.publish("hotReload", { hmr: false, owner: "bin" });

    const tools = harness.connect("tools");

    const methods = tools.messages().map(message => ("method" in message ? message.method : ""));
    expect(methods).toEqual(["sessions", "hotReload"]);
    expect(paramsOf(tools.notes("editor", "hotReload")[0])).toEqual({ hmr: false, owner: "bin" });
  });

  it("keeps a value published before start for the first tools page", () => {
    const ctx = createCtx();
    const api = createHubApi(ctx);

    api.publish("hotReload", { hmr: true, owner: "bin" });
    expect(ctx.state.published.get("hotReload")).toEqual({ hmr: true, owner: "bin" });

    ctx.state.token = "t".repeat(43);
    const tools = fakeSocket("tools", ctx.state.nextConn++);
    api.websocket.open(tools);
    expect(tools.notes("editor", "hotReload")).toHaveLength(1);
  });

  it("stores a copy: changing the published object later changes nothing", () => {
    const harness = createHarness();
    const state = { hmr: true, owner: "bin" as const };
    createHubApi(harness.ctx).publish("hotReload", state);
    Reflect.set(state, "hmr", false);

    const tools = harness.connect("tools");
    expect(paramsOf(tools.notes("editor", "hotReload")[0])).toEqual({ hmr: true, owner: "bin" });
  });

  it("sends nothing but the sessions list when nothing was published", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    expect(tools.messages()).toHaveLength(1);
  });

  it("sends a selection as plain Json, items included", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    tools.clear();

    createHubApi(harness.ctx).publish("selection", AREA);

    expect(paramsOf(tools.notes("editor", "selection")[0])).toEqual({
      ref: { kind: "ui", path: "column#0/hudRow/coins" },
      name: "area",
      type: "area",
      rect: { x: 0, y: 30, w: 200, h: 60 },
      area: { x: 0, y: 30, w: 200, h: 60 },
      items: [{ ref: { kind: "ui", path: "column#0/hudRow/coins" }, name: "coins", type: "text" }],
      at: 1_790_000_000_000
    });
  });

  it("sends a null selection as a notification without params, live and on replay", () => {
    const harness = createHarness();
    const api = createHubApi(harness.ctx);
    const tools = harness.connect("tools");
    tools.clear();

    api.publish("selection", null); // eslint-disable-line unicorn/no-null -- null: nothing is selected
    const later = harness.connect("tools");

    const cleared = { jsonrpc: "2.0", channel: "editor", method: "selection" };
    expect(tools.notes("editor", "selection")).toEqual([cleared]);
    expect(later.notes("editor", "selection")).toEqual([cleared]);
    expect(harness.ctx.state.published.get("selection")).toBeNull();
  });
});
