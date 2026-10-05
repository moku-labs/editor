import { describe, expect, it } from "vitest";
import { createHubApi } from "../../api";
import { closeAll } from "../../sockets/close";
import { createHarness, TOKEN } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// closeAll (U11): the bin closes every socket with 1012 "editor restarting"
// before it restarts its server. The hub keeps running: its token stays, and
// each connection is forgotten when Bun reports its close.
// ─────────────────────────────────────────────────────────────────────────────

describe("closeAll", () => {
  it("closes every agent, tools and page socket with the code and the reason", () => {
    const harness = createHarness();
    const { agent } = harness.hello();
    const tools = harness.connect("tools");
    const page = harness.page();

    closeAll(harness.ctx, 1012, "editor restarting");

    const restarting = [{ code: 1012, reason: "editor restarting" }];
    expect(agent.closes).toEqual(restarting);
    expect(tools.closes).toEqual(restarting);
    expect(page.closes).toEqual(restarting);
  });

  it("logs the close at info with the socket count", () => {
    const harness = createHarness();
    harness.connect("tools");
    harness.connect("agent");

    closeAll(harness.ctx, 1012, "editor restarting");

    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:close-all", {
      code: 1012,
      reason: "editor restarting",
      sockets: 2
    });
    expect(harness.ctx.log.warn).not.toHaveBeenCalled();
  });

  it("keeps the hub running: the token stays, Bun's close forgets each connection, a new socket opens", () => {
    const harness = createHarness();
    const { agent, session } = harness.hello();
    const tools = harness.connect("tools");

    closeAll(harness.ctx, 1012, "editor restarting");
    expect(harness.ctx.state.conns.size).toBe(2);
    harness.close(agent, 1012);
    harness.close(tools, 1012);

    const { state } = harness.ctx;
    expect(state.token).toBe(TOKEN);
    expect(state.conns.size).toBe(0);
    expect(state.sessions.has(session)).toBe(false);
    const again = harness.connect("tools");
    expect(again.closes).toEqual([]);
    expect(again.notes("editor", "sessions")).toHaveLength(1);
  });

  it("does nothing to a hub without sockets", () => {
    const harness = createHarness();

    expect(() => {
      closeAll(harness.ctx, 1012, "editor restarting");
    }).not.toThrow();
    expect(harness.ctx.log.info).toHaveBeenCalledWith("hub:close-all", {
      code: 1012,
      reason: "editor restarting",
      sockets: 0
    });
  });

  it("is the api member closeAll", () => {
    const harness = createHarness();
    const tools = harness.connect("tools");
    const api = createHubApi(harness.ctx);

    api.closeAll(1012, "editor restarting");

    expect(tools.closes).toEqual([{ code: 1012, reason: "editor restarting" }]);
  });
});
