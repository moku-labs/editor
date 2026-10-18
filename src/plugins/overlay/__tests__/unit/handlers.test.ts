// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createHandlers } from "../../handlers";
import { openOverlay, setTab } from "../../modes";
import { bracketMonitor, createOctx, pluginCtxOf, started, stopped } from "../helpers";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__MOKU_GAME_OVERLAY__");
});

describe("createHandlers", () => {
  it("a recorder:status between ticks renders at once (it is stored, the next tick shows it)", () => {
    const octx = started(createOctx());
    const monitor = bracketMonitor();
    octx.perf.monitorValue = monitor;
    openOverlay(octx);
    const before = monitor.calls.length;
    const hooks = createHandlers(pluginCtxOf(octx));
    hooks["recorder:status"]({ state: "recording", lines: 10, bytes: 400, sent: 0, pending: 10 });
    hooks["bridge:status"]({ status: { kind: "live", frame: 12 }, session: "s-7f3a" });
    expect(octx.state.rec).toEqual({
      state: "recording",
      lines: 10,
      bytes: 400,
      sent: 0,
      pending: 10
    });
    expect(octx.state.link).toEqual({ status: { kind: "live", frame: 12 }, session: "s-7f3a" });
    expect(monitor.calls).toHaveLength(before);
    stopped(octx);
  });

  it("a pairing code that appears while another tab shows moves nothing", () => {
    const octx = started(createOctx());
    openOverlay(octx);
    setTab(octx, "record");
    createHandlers(pluginCtxOf(octx))["bridge:status"]({
      status: { kind: "connecting" },
      link: { mode: "connecting", address: "192.168.1.5:47600", pairing: { code: "4821" } }
    });
    expect(octx.state.tab).toBe("record");
    stopped(octx);
  });
});
