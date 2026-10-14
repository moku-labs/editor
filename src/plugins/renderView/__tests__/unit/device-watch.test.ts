// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is the wire's "frame no longer on the phone" */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Json, Manifest, SessionInfo } from "../../../registry/protocol";
import { toWireValue, wireError } from "../../../registry/protocol";
import { createRenderViewApi } from "../../api";
import { onLinkStatus, onWorkspaceChanged } from "../../handlers";
import { refreshRenderView, startTracker } from "../../watch";
import {
  DEVICE,
  deviceSession,
  recorderOf,
  recordOf,
  secondOf,
  spikesOf,
  windowWire,
  wireJson
} from "../device-fixtures";
import {
  boardCapture,
  createCtx,
  flush,
  GAME_01_SOURCES,
  manifestOf,
  stubFrames,
  type TestCtx
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// device/watch.ts with a mock link: the strip shows for a session whose
// manifest lists editor.perf.second (a phone or the browser), its watches run
// while Render is shown, a phone gets no scene read (R4), the record read is
// shared while it loads and a late answer is dropped.
// ─────────────────────────────────────────────────────────────────────────────

/** The device sources of an agent with perf and the recorder. */
const PERF_SOURCES = [
  "editor.perf.second",
  "editor.perf.window",
  "editor.perf.spikes",
  "editor.perf.spike",
  "editor.recorder"
];

/** The four watched device sources. */
const WATCHED = [
  "editor.perf.second",
  "editor.perf.window",
  "editor.perf.spikes",
  "editor.recorder"
];

/** The three scene sources. */
const SCENE = ["game.ui", "game.entities", "game.projections"];

let ctx: TestCtx;
let sessions: SessionInfo[];
let chosen: string | undefined;

/**
 * Attaches a session to the mock link: the session list, the choice and its manifest.
 *
 * @param session - The session.
 * @param sources - The manifest's sources.
 */
function attach(
  session: SessionInfo,
  sources: readonly string[] = [...GAME_01_SOURCES, ...PERF_SOURCES]
): void {
  sessions = [session];
  chosen = session.id;
  ctx.link.attach(manifestOf(sources));
}

/**
 * Shows Render through the workspace:changed hook.
 */
function showRender(): void {
  onWorkspaceChanged(ctx)({ ws: "render" });
}

/**
 * The ids of the active watches of a set of sources.
 *
 * @param ids - The source ids.
 * @returns The watched ids, one per active watch.
 */
function watched(ids: readonly string[]): string[] {
  return ctx.link
    .active()
    .map(record => record.id)
    .filter(id => ids.includes(id));
}

/**
 * Delivers the demo values of the four device sources.
 */
function deliverDemo(): void {
  ctx.link.send("editor.perf.second", toWireValue(secondOf()));
  ctx.link.send("editor.perf.window", wireJson(windowWire()));
  ctx.link.send("editor.perf.spikes", toWireValue(spikesOf()));
  ctx.link.send("editor.recorder", toWireValue(recorderOf()));
}

beforeEach(() => {
  ctx = createCtx();
  sessions = [];
  chosen = undefined;
  ctx.link.api.sessions = () => sessions;
  ctx.link.api.session = () => chosen;
  ctx.link.manifestValue = undefined;
  stubFrames();
  startTracker(ctx);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("which sessions get the strip", () => {
  it("a device session with Render shown watches the four sources once", () => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    ctx.link.attach(ctx.link.manifestValue);
    showRender();

    expect(watched(WATCHED).toSorted()).toEqual([...WATCHED].toSorted());
    expect(createRenderViewApi(ctx).device()?.link).toEqual({
      kind: "adb",
      address: "127.0.0.1",
      port: 47_600
    });
  });

  it("a source the manifest lists unavailable is not watched", () => {
    attach(deviceSession("s-1", DEVICE));
    ctx.link.attach({
      ...manifestOf([...GAME_01_SOURCES, ...PERF_SOURCES]),
      sources: manifestOf([...GAME_01_SOURCES, ...PERF_SOURCES]).sources.map(source =>
        source.id === "editor.recorder" ? { ...source, available: false } : source
      )
    } satisfies Manifest);
    showRender();

    expect(watched(["editor.recorder"])).toEqual([]);
    expect(createRenderViewApi(ctx).device()?.rec).toBeUndefined();
  });

  it("Render hidden drops every device watch and keeps the data", () => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    deliverDemo();

    onWorkspaceChanged(ctx)({ ws: "flow" });

    expect(watched(WATCHED)).toEqual([]);
    expect(ctx.state.device.second).toBeDefined();
    expect(ctx.state.device.window.count).toBe(360);
  });

  it("a browser session whose manifest lists editor.perf.* watches the four sources and keeps its scene watches and its calibration", async () => {
    attach(deviceSession("s-1"));
    showRender();

    expect(watched(WATCHED).toSorted()).toEqual([...WATCHED].toSorted());
    expect(watched(SCENE).toSorted()).toEqual([...SCENE].toSorted());
    ctx.link.send("game.ui", boardCapture().ui);
    await flush();
    expect(ctx.link.api.read).toHaveBeenCalledWith("game.rect", expect.anything());
    expect(createRenderViewApi(ctx).device()?.link).toEqual({ kind: "browser" });
  });

  it("a session whose manifest lists no editor.perf.second sends no editor.perf watch and has no strip", () => {
    attach(deviceSession("s-1"), GAME_01_SOURCES);
    showRender();

    expect(watched(WATCHED)).toEqual([]);
    expect(createRenderViewApi(ctx).device()).toBeUndefined();
    expect(watched(SCENE)).toHaveLength(3);
  });

  it("a device session sends no game.ui / game.entities / game.projections watch and no calibration read", async () => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    await refreshRenderView(ctx);

    expect(watched(SCENE)).toEqual([]);
    expect(ctx.link.api.read).not.toHaveBeenCalledWith("game.rect", expect.anything());
    expect(ctx.link.api.read).not.toHaveBeenCalledWith("game.locate", expect.anything());
  });

  it("a phone attached while Render shows a browser session drops the scene watches", () => {
    attach(deviceSession("s-1"));
    showRender();
    expect(watched(SCENE)).toHaveLength(3);

    attach(deviceSession("s-2", DEVICE));

    expect(watched(SCENE)).toEqual([]);
    expect(watched(WATCHED)).toHaveLength(4);
  });
});

describe("the strip's data", () => {
  it("stores each value, marks the strip dirty and warns a value of the wrong shape", () => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    deliverDemo();

    expect(ctx.state.device.dirty).toBe(true);
    expect(ctx.state.device.spikes).toHaveLength(6);
    expect(ctx.state.device.recorder?.state).toBe("recording");

    ctx.link.send("editor.perf.second", { state: "on" });
    expect(ctx.log.warn).toHaveBeenCalledWith("renderView: unexpected source shape", {
      id: "editor.perf.second"
    });
    expect(ctx.state.device.second?.fps.drawn).toBe(54);
  });

  it("a session change clears the strip state and drops the record read in flight", async () => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    deliverDemo();
    const opened = createRenderViewApi(ctx).openSpike(4812);

    attach(deviceSession("s-2", DEVICE));
    await opened;

    expect(ctx.state.device.session?.id).toBe("s-2");
    expect(ctx.state.device.second).toBeUndefined();
    expect(ctx.state.device.window.count).toBe(0);
    expect(ctx.state.device.record).toEqual({ kind: "closed" });
    expect(ctx.state.device.selected).toBeUndefined();
  });

  it("the link going empty clears the strip; silent keeps it", () => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    deliverDemo();

    onLinkStatus(ctx)({ status: { kind: "silent", since: 1, lastFrame: 4845 }, session: "s-1" });
    expect(createRenderViewApi(ctx).device()).toBeDefined();

    onLinkStatus(ctx)({ status: { kind: "empty" } });
    expect(createRenderViewApi(ctx).device()).toBeUndefined();
    expect(watched(WATCHED)).toEqual([]);
  });
});

/**
 * Makes `link.read("editor.perf.spike")` answer through a promise the test settles.
 *
 * @returns The settle functions of every read, in order.
 */
function scriptedReads(): { resolve: (value: Json) => void; reject: (error: Error) => void }[] {
  const reads: { resolve: (value: Json) => void; reject: (error: Error) => void }[] = [];
  ctx.link.api.read = vi.fn(
    () =>
      new Promise<Json>((resolve, reject) => {
        reads.push({ resolve, reject });
      })
  );
  return reads;
}

describe("the record read", () => {
  beforeEach(() => {
    attach(deviceSession("s-1", DEVICE));
    showRender();
    deliverDemo();
  });

  it("openSpike twice for one loading frame reads once", async () => {
    const reads = scriptedReads();
    const api = createRenderViewApi(ctx);

    const first = api.openSpike(4812);
    const second = api.openSpike(4812);
    expect(ctx.link.api.read).toHaveBeenCalledTimes(1);
    expect(ctx.link.api.read).toHaveBeenCalledWith("editor.perf.spike", { frame: 4812 });

    reads[0]?.resolve(toWireValue(recordOf()));
    await Promise.all([first, second]);
    expect(api.device()?.record).toBe("shown");
    expect(api.device()?.selected).toBe(4812);
  });

  it("a null answer shows 'gone'", async () => {
    const reads = scriptedReads();
    const opened = createRenderViewApi(ctx).openSpike(4572);

    reads[0]?.resolve(null);
    await opened;

    expect(ctx.state.device.record).toEqual({ kind: "gone", frame: 4572 });
  });

  it("a failed read shows its bare message and never rejects", async () => {
    const reads = scriptedReads();
    const opened = createRenderViewApi(ctx).openSpike(4572);

    reads[0]?.reject(wireError(-32_003, "No session is open."));
    await expect(opened).resolves.toBeUndefined();

    expect(ctx.state.device.record).toEqual({
      kind: "failed",
      frame: 4572,
      message: "No session is open."
    });
  });

  it("a late answer after closeSpike is dropped", async () => {
    const reads = scriptedReads();
    const api = createRenderViewApi(ctx);
    const opened = api.openSpike(4812);

    api.closeSpike();
    reads[0]?.resolve(toWireValue(recordOf()));
    await opened;

    expect(api.device()?.record).toBe("closed");
    expect(api.device()?.selected).toBe(4812);
  });

  it("a late answer for frame A after opening frame B is dropped", async () => {
    const reads = scriptedReads();
    const api = createRenderViewApi(ctx);
    const first = api.openSpike(4812);
    const second = api.openSpike(4845);

    reads[0]?.resolve(toWireValue(recordOf()));
    await first;
    expect(ctx.state.device.record).toEqual({ kind: "loading", frame: 4845 });

    reads[1]?.resolve(toWireValue(recordOf({ frame: 4845 })));
    await second;
    expect(api.device()?.recordFrame).toBe(4845);
    expect(api.device()?.record).toBe("shown");
  });
});
