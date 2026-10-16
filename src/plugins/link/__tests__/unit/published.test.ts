/* eslint-disable unicorn/no-null -- null is a JSON value on the wire */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DeviceDirectory, DeviceTelemetry } from "../../../connect/protocol";
import type { PublishParams, SelectionInfo } from "../../../registry/protocol";
import { toWireValue } from "../../../registry/protocol";
import { createLinkApi } from "../../api";
import { stopLink } from "../../lifecycle";
import type { LinkApi } from "../../types";
import {
  connected,
  createCtx,
  directoryOf,
  FakeWebSocket,
  latestSocket,
  type TestCtx,
  telemetryOf
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// published / onPublished (spec 11 § 5.2): the last valid value per publish
// method, kept across reconnects; a malformed one is warned and ignored; an
// equal replay calls no listener.
// ─────────────────────────────────────────────────────────────────────────────

const ENGINE = { id: "0.15.0+1ab7f2", version: "0.15.0", dist: "1ab7f2c0" };

const SELECTION: SelectionInfo = {
  ref: { kind: "ui", path: "column#0/hudRow/coins" },
  key: "coins",
  name: "coins",
  type: "text",
  at: 1_791_986_083_000
};

let ctx: TestCtx;
let socket: FakeWebSocket;
let api: LinkApi;

beforeEach(async () => {
  vi.useFakeTimers();
  vi.stubGlobal("WebSocket", FakeWebSocket);
  FakeWebSocket.instances.length = 0;
  ctx = createCtx();
  socket = await connected(ctx);
  api = createLinkApi(ctx);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/**
 * Drops the socket and lets the reconnect open a new one, as after a server restart.
 */
async function reconnect(): Promise<void> {
  socket.drop();
  await vi.advanceTimersByTimeAsync(1000);
  socket = latestSocket();
  socket.open();
}

describe("editor.devices", () => {
  it("a directory is held, frozen, and given to every onPublished listener", () => {
    const seen: DeviceDirectory[] = [];
    api.onPublished("devices", value => seen.push(value));
    expect(api.published("devices")).toBeUndefined();

    socket.notify("editor", "devices", toWireValue(directoryOf()));

    expect(api.published("devices")).toEqual(directoryOf());
    expect(seen).toEqual([directoryOf()]);
    // A panel that edits what it got must not change what the next reader sees.
    expect(Object.isFrozen(api.published("devices")?.linked[0])).toBe(true);
  });

  it("a malformed directory is the warning link:bad-published and keeps the held one", () => {
    const seen: DeviceDirectory[] = [];
    api.onPublished("devices", value => seen.push(value));
    socket.notify("editor", "devices", toWireValue(directoryOf()));

    socket.notify("editor", "devices", toWireValue({ ...directoryOf(), v: 2 }));
    socket.notify("editor", "devices");

    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-published", { method: "devices" });
    expect(ctx.log.warn).toHaveBeenCalledTimes(2);
    expect(api.published("devices")).toEqual(directoryOf());
    expect(seen).toHaveLength(1);
  });

  it("the hub's replay of an equal directory after a reconnect calls no listener", async () => {
    // Bug: the Connect panel flickering on every reconnect.
    const seen: DeviceDirectory[] = [];
    api.onPublished("devices", value => seen.push(value));
    socket.notify("editor", "devices", toWireValue(directoryOf()));

    await reconnect();
    socket.notify("editor", "devices", toWireValue(directoryOf()));
    expect(seen).toHaveLength(1);

    const asking = directoryOf({
      asking: [
        {
          ticket: "p-3",
          model: "IPHONE15,4",
          address: "192.168.1.23",
          link: "lan",
          engine: null,
          build: null,
          since: 1_791_986_090_000
        }
      ]
    });
    socket.notify("editor", "devices", toWireValue(asking));
    expect(seen).toEqual([directoryOf(), asking]);
    expect(api.published("devices")?.asking[0]?.ticket).toBe("p-3");
  });
});

describe("editor.deviceTelemetry", () => {
  it("each tick replaces the held record; a malformed one is warned and the last stays", () => {
    const seen: DeviceTelemetry[] = [];
    api.onPublished("deviceTelemetry", value => seen.push(value));

    socket.notify("editor", "deviceTelemetry", toWireValue(telemetryOf(1000)));
    socket.notify("editor", "deviceTelemetry", toWireValue(telemetryOf(2000)));
    socket.notify("editor", "deviceTelemetry", { v: 1, device: "d-7f3a" });

    expect(seen.map(record => record.at)).toEqual([1000, 2000]);
    expect(api.published("deviceTelemetry")).toEqual(telemetryOf(2000));
    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-published", {
      method: "deviceTelemetry"
    });
  });
});

describe("onPublished listeners", () => {
  it("a throwing listener is logged and the next one still runs", () => {
    const failure = new Error("boom");
    const second = vi.fn();
    api.onPublished("devices", () => {
      throw failure;
    });
    api.onPublished("devices", second);

    socket.notify("editor", "devices", toWireValue(directoryOf()));

    expect(ctx.log.error).toHaveBeenCalledWith(
      "link:published-listener-failed",
      { method: "devices" },
      failure
    );
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("the unsubscribe stops only its own entry; stop forgets every listener", () => {
    const kept = vi.fn();
    const removed = vi.fn();
    api.onPublished("devices", kept);
    const off = api.onPublished("devices", removed);

    off();
    off();
    socket.notify("editor", "devices", toWireValue(directoryOf()));
    expect(removed).not.toHaveBeenCalled();
    expect(kept).toHaveBeenCalledTimes(1);

    api.onSessions(vi.fn());
    stopLink(ctx);
    expect(ctx.state.publishedListeners.devices.size).toBe(0);
    expect(ctx.state.sessionsListeners.size).toBe(0);
  });
});

describe("the values link already keeps", () => {
  it("published answers engine, project, hotReload and selection from link's own values", () => {
    socket.notify("editor", "engine", ENGINE);
    socket.notify("editor", "project", { state: "off", reason: "disabled" });
    socket.notify("editor", "hotReload", { hmr: true, owner: "bin" });
    socket.notify("editor", "selection", toWireValue(SELECTION));

    expect(api.published("engine")).toEqual(ENGINE);
    expect(api.published("project")).toEqual({ state: "off", reason: "disabled" });
    expect(api.published("hotReload")).toEqual({ hmr: true, owner: "bin" });
    expect(api.published("selection")).toEqual(SELECTION);
  });

  it("an engine without its version or dist is the warning link:bad-engine and keeps the held one", () => {
    socket.notify("editor", "engine", ENGINE);

    socket.notify("editor", "engine", { id: "0.15.1+77aa01" });

    expect(ctx.log.warn).toHaveBeenCalledWith("link:bad-engine", {});
    expect(api.published("engine")).toEqual(ENGINE);
    expect(api.engine()).toBe("0.15.0+1ab7f2");
  });

  it("a patched engine keeps its patch; a malformed patch is left out and the engine stays", () => {
    // Bug: one bad patch field blanking the engine id, so STALE never compares again.
    const patch = { file: "patches/@moku-labs+game+0.15.0.patch", hash: "c0ffee" };
    socket.notify("editor", "engine", { ...ENGINE, patch });
    expect(api.published("engine")).toEqual({ ...ENGINE, patch });

    socket.notify("editor", "engine", { ...ENGINE, id: "0.15.0+2bd9e1", patch: { file: 7 } });
    expect(api.published("engine")).toEqual({ ...ENGINE, id: "0.15.0+2bd9e1" });
    expect(api.engine()).toBe("0.15.0+2bd9e1");
  });

  it("the engine id unknown is held as published while engine() answers undefined", () => {
    const unknown = { ...ENGINE, id: "unknown" };
    socket.notify("editor", "engine", unknown);

    expect(api.published("engine")).toEqual(unknown);
    expect(api.engine()).toBeUndefined();
  });

  it("onPublished hears each new engine, project, hotReload and selection once, not their replays", () => {
    const heard: { method: string; value: PublishParams[keyof PublishParams] }[] = [];
    for (const method of ["engine", "project", "hotReload", "selection"] as const) {
      api.onPublished(method, value => heard.push({ method, value }));
    }

    for (let round = 0; round < 2; round += 1) {
      socket.notify("editor", "engine", ENGINE);
      socket.notify("editor", "project", { state: "off", reason: "disabled" });
      socket.notify("editor", "hotReload", { hmr: true, owner: "bin" });
      socket.notify("editor", "selection", toWireValue(SELECTION));
    }
    socket.notify("editor", "selection");
    socket.notify("editor", "selection");

    expect(heard).toEqual([
      { method: "engine", value: ENGINE },
      { method: "project", value: { state: "off", reason: "disabled" } },
      { method: "hotReload", value: { hmr: true, owner: "bin" } },
      { method: "selection", value: SELECTION },
      { method: "selection", value: null }
    ]);
    expect(api.published("selection")).toBeUndefined();
  });
});
