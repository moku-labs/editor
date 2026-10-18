// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { toWireValue } from "../../../registry/protocol";
import { createHandlers } from "../../handlers";
import { startRenderView, stopRenderView } from "../../lifecycle";
import type { ActiveSource, SourceChange } from "../../source/contract";
import { startMission, stopMission, syncSource, timeOriginOf } from "../../source/sync";
import { DEVICE, recorderOf, secondOf } from "../device-fixtures";
import { type MissionCtx, missionCtx, settle } from "../mission-ctx";
import { bitsOf, rowsOf, wireOf } from "../mission-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// source/sync.ts and the hooks of activeSource (spec 09 § M2 rules 3–5, M13):
// the watch set of the active source and the switch burst.
// ─────────────────────────────────────────────────────────────────────────────

const LOCAL: ActiveSource = { kind: "local", session: "s-1" };
const PHONE: ActiveSource = { kind: "device", session: "s-9", device: DEVICE };

let ctx: MissionCtx;

beforeEach(() => {
  vi.useFakeTimers();
  ctx = missionCtx();
});

afterEach(() => {
  stopRenderView(ctx);
  vi.useRealTimers();
});

/**
 * A source change.
 *
 * @param to - The new source.
 * @param reason - Why.
 * @returns The change.
 */
function changeTo(to: ActiveSource, reason: SourceChange["reason"] = "connected"): SourceChange {
  return { from: ctx.state.mission.source ?? LOCAL, to, reason, at: 1_792_000_093_963 };
}

/**
 * Fills the history through the poll's first read.
 */
async function fillHistory(): Promise<void> {
  const frames = ctx.reads.find(read => read.id === "editor.perf.frames");
  frames?.resolve(
    toWireValue(
      wireOf(rowsOf(1, 60, { t0: 10_000, each: () => ({ ms: 30, causes: bitsOf("js") }) }))
    )
  );
  await settle();
}

describe("the watch set", () => {
  it("Render shown watches second, passes and recorder and starts the poll — only what the manifest lists", () => {
    // Bug: an older agent asked for feeds it does not have (errors every second).
    startMission(ctx);
    expect(ctx.link.active().map(record => record.id)).toEqual([
      "editor.perf.second",
      "editor.perf.passes",
      "editor.recorder"
    ]);
    expect(ctx.state.mission.poll.timer).toBeDefined();

    const older = missionCtx({ sources: ["editor.perf.second"] });
    startMission(older);
    expect(older.link.active().map(record => record.id)).toEqual(["editor.perf.second"]);
    expect(older.state.mission.poll.timer).toBeUndefined();
    stopMission(older.state);
  });

  it("a value of another shape is dropped and warned, never shown", () => {
    // Bug: a broken second shown as zeros in the bar.
    startMission(ctx);
    ctx.link.send("editor.perf.second", { state: "on" });
    expect(ctx.state.mission.second).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.perf.second"
    });

    ctx.link.send("editor.perf.second", toWireValue(secondOf({ epoch: "1792000000000.5" })));
    expect(ctx.state.mission.second?.fps.loop).toBe(60);
    expect(ctx.state.mission.series.textures.count).toBe(1);
    ctx.link.send("editor.perf.passes", null);
    expect(ctx.state.mission.passes).toBeNull();
  });

  it("Render hidden drops the watches and the poll and keeps the history", async () => {
    // Bug: a hidden Render reading the phone every second, or a return that lost two minutes.
    const hooks = createHandlers(ctx);
    hooks["workspace:changed"]({ ws: "render" });
    await fillHistory();
    hooks["workspace:changed"]({ ws: "flow" });

    expect(ctx.link.active().filter(record => record.id.startsWith("editor."))).toEqual([]);
    expect(ctx.state.mission.poll.timer).toBeUndefined();
    expect(ctx.state.mission.history.count).toBe(60);
  });
});

describe("the switch burst", () => {
  it("activeSource:changed stops every old watch and the poll in one burst, resets the history and the series, returns to live, clears the selection and closes popovers", async () => {
    // Bug: a device series surviving into the local preview (two sources in one graph).
    const { mission } = ctx.state;
    startMission(ctx);
    await fillHistory();
    const oldWatches = ctx.link.active().filter(record => record.id.startsWith("editor."));
    mission.view.live = false;
    mission.selection = { from: 3, to: 9 };
    mission.popover = "monitoring";
    mission.rate.answer = { ok: false, choice: 120, text: "Refused" };

    createHandlers(ctx)["activeSource:changed"](changeTo(PHONE));

    expect(oldWatches.every(record => !record.active)).toBe(true);
    expect(mission.history.count).toBe(0);
    expect(mission.series.overview.count).toBe(0);
    expect(mission.view.live).toBe(true);
    expect(mission.selection).toBeUndefined();
    expect(mission.popover).toBeUndefined();
    expect(mission.rate.answer).toBeUndefined();
    expect(mission.source).toBe(PHONE);
    expect(ctx.link.active().filter(record => record.id.startsWith("editor.")).length).toBe(3);
  });

  it("a device source sends no game.ui / game.entities / game.projections watch; the local preview keeps them", () => {
    // Bug: the phone asked for its scene every frame (spec 09 R4).
    syncSource(ctx, changeTo(LOCAL, "user"), false);
    expect(ctx.link.active().map(record => record.id)).toEqual(
      expect.arrayContaining(["game.ui", "game.entities", "game.projections"])
    );
    syncSource(ctx, changeTo(PHONE), false);
    expect(ctx.link.active().some(record => record.id.startsWith("game."))).toBe(false);
  });

  it("a switch to a device while the Connect panel is open shows the success alert, toasts once and closes after 1.3 s", async () => {
    // Bug: the panel closing at once (the alert never seen), or staying open forever.
    ctx.activeSource.label = { ...ctx.activeSource.label, name: "Galaxy A26" };
    const hooks = createHandlers(ctx);
    hooks["activeSource:connect-requested"]({ tab: "network" });
    hooks["activeSource:changed"](changeTo(PHONE, "connected"));

    expect(ctx.state.mission.popover).toBe("connect");
    expect(ctx.state.mission.connect.alert).toBe("Galaxy A26");
    expect(ctx.workspace.toast).toHaveBeenCalledWith(
      "Galaxy A26 connected. The local preview is paused."
    );
    await vi.advanceTimersByTimeAsync(1300);
    expect(ctx.state.mission.popover).toBeUndefined();
    expect(ctx.activeSource.scanStops).toHaveBeenCalledTimes(1);
    expect(ctx.workspace.toast).toHaveBeenCalledTimes(1);
  });

  it("activeSource:connect-requested shows Render and opens the Connect panel on its tab", () => {
    // Bug: the top bar's "Connect device…" opening nothing outside Render.
    createHandlers(ctx)["activeSource:connect-requested"]({ tab: "network" });
    expect(ctx.workspace.show).toHaveBeenCalledWith("render");
    expect(ctx.state.mission.popover).toBe("connect");
    expect(ctx.state.mission.connect.tab).toBe("network");
    expect(ctx.activeSource.api.scan).toHaveBeenCalledTimes(1);
  });
});

describe("the lifecycle", () => {
  it("onStart takes the source and the telemetry; a record is placed with the clock offset", () => {
    // Bug: the Device load card empty on a wired phone (telemetry never subscribed).
    ctx.state.mission.source = undefined;
    ctx.activeSource.current = PHONE;
    startRenderView(ctx);
    expect(ctx.state.mission.source).toBe(PHONE);
    ctx.state.mission.second = secondOf({ epoch: "1792000000000" });
    ctx.activeSource.offset = -412;
    const off = { available: false as const, source: "none", reason: "warming-up" as const };
    ctx.activeSource.sendTelemetry({
      v: 1,
      device: "d-7f3a",
      serial: null,
      at: 1_792_000_050_000,
      wired: true,
      gpu: {
        available: true,
        source: "/sys/kernel/gpu",
        value: { mhz: 585, busyPct: 64, minMhz: 221, maxMhz: 949 }
      },
      cpu: { cores: 8, app: off, renderer: off, surfaceflinger: off },
      memory: { app: off, renderer: off },
      heap: off
    });
    expect(ctx.state.mission.telemetry?.device).toBe("d-7f3a");
    expect(ctx.state.mission.series.load.gpuMhz.t[0]).toBe(50_000 - 412);
  });

  it("onStop leaves no watch, poll, scan lease or timer behind", async () => {
    // Bug: an interval or a scan lease kept after the tools page stopped.
    const hooks = createHandlers(ctx);
    hooks["workspace:changed"]({ ws: "render" });
    hooks["activeSource:connect-requested"]({ tab: "wire" });
    stopRenderView(ctx);
    expect(ctx.link.active()).toEqual([]);
    expect(ctx.state.mission.poll.timer).toBeUndefined();
    expect(ctx.activeSource.scanStops).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
    await settle();
  });
});

describe("the watched values", () => {
  it("takes the recorder and the passes; warns about broken ones; a second without an epoch is placed at the newest frame", async () => {
    // Bug: the recording pill fed a broken value, or a second placed at time 0.
    startMission(ctx);
    ctx.link.send("editor.recorder", toWireValue({ ...recorderOf(), marks: [] }));
    expect(ctx.state.mission.recorder?.state).toBe("recording");
    ctx.link.send("editor.recorder", { state: "recording" });
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.recorder"
    });
    ctx.link.send("editor.perf.passes", { v: 2 });
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.perf.passes"
    });
    const passes = {
      v: 1,
      source: "agent",
      t: 81_000,
      frames: 60,
      tiler: false,
      gpuTimer: true,
      rows: null,
      heaviest: null,
      line: null,
      shaders: null,
      targets: null,
      lost: 0
    };
    ctx.link.send("editor.perf.passes", passes);
    expect(ctx.state.mission.history.secondCount).toBe(1);

    await fillHistory();
    ctx.link.send("editor.perf.second", toWireValue(secondOf()));
    expect(ctx.state.mission.series.textures.t[0]).toBeCloseTo(10_000 + 59 * 16.67 + 30, 3);
    expect(timeOriginOf(secondOf({ epoch: "1792000000000.5" }))).toBe(1_792_000_000_000.5);
    expect(timeOriginOf(secondOf({ epoch: null }))).toBeNull();
    expect(timeOriginOf(undefined)).toBeNull();
  });
});
