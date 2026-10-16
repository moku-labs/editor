import { describe, expect, it } from "vitest";
import { COLOUR } from "../../model/format";
import {
  engineLine,
  headerView,
  isStale,
  linkLegend,
  pillLabel,
  profileText
} from "../../model/header";
import type { LinkPayload } from "../../types";
import { secondOf } from "../helpers";

const live: LinkPayload = { status: { kind: "live", frame: 12 } };

/**
 * A device-mode payload.
 *
 * @param link - The device link.
 * @returns The payload.
 */
function device(link: NonNullable<LinkPayload["link"]>): LinkPayload {
  return { status: { kind: "live", frame: 1 }, link };
}

describe("linkLegend", () => {
  it("no bridge reads NO PC in ink", () => {
    expect(linkLegend(live, false)).toEqual({ kind: "none", text: "NO PC", colour: COLOUR.ink });
  });

  it("page mode shows NO PC while live (DEV, green while live or paused, ink otherwise)", () => {
    expect(linkLegend(live, true)).toEqual({ kind: "dev", text: "DEV", colour: COLOUR.live });
    expect(linkLegend({ status: { kind: "paused", frame: 3 } }, true).colour).toBe(COLOUR.live);
    expect(linkLegend({ status: { kind: "connecting" } }, true)).toEqual({
      kind: "dev",
      text: "DEV",
      colour: COLOUR.ink
    });
    expect(linkLegend(undefined, true).colour).toBe(COLOUR.ink);
  });

  it("a connecting LAN address shows ADB (it reads LAN; a loopback reads ADB)", () => {
    expect(linkLegend(device({ mode: "connecting", address: "192.168.1.5:47600" }), true)).toEqual({
      kind: "connecting",
      text: "LAN",
      colour: COLOUR.caution
    });
    expect(linkLegend(device({ mode: "connecting", address: "127.0.0.1:47600" }), true).text).toBe(
      "ADB"
    );
  });

  it("device modes none, adb and lan", () => {
    expect(linkLegend(device({ mode: "none", address: "127.0.0.1:47600" }), true)).toEqual({
      kind: "none",
      text: "NO PC",
      colour: COLOUR.ink
    });
    expect(linkLegend(device({ mode: "adb", address: "127.0.0.1:47600" }), true)).toEqual({
      kind: "adb",
      text: "ADB",
      colour: COLOUR.live
    });
    expect(linkLegend(device({ mode: "lan", address: "192.168.1.5:47600" }), true)).toEqual({
      kind: "lan",
      text: "LAN",
      colour: COLOUR.live
    });
  });
});

describe("isStale", () => {
  it("STALE shows when the computer's engine is unknown (it does not)", () => {
    const unknown = device({ mode: "adb", address: "127.0.0.1:47600" });
    expect(isStale("0.14.12+9c41e0", unknown)).toBe(false);
    expect(isStale(undefined, device({ mode: "adb", address: "a:1", editorEngine: "x" }))).toBe(
      false
    );
  });

  it("is true only when both engines are known and differ", () => {
    const other = device({ mode: "lan", address: "a:1", editorEngine: "0.14.13+1ab7f2" });
    expect(isStale("0.14.12+9c41e0", other)).toBe(true);
    expect(isStale("0.14.13+1ab7f2", other)).toBe(false);
  });
});

describe("headerView", () => {
  it("STALE replaces REC (both show: STALE takes the link legend's place, REC stays)", () => {
    const header = headerView({
      second: secondOf(),
      status: { state: "on", lost: 0, gpuTimer: true },
      payload: device({ mode: "adb", address: "127.0.0.1:47600", editorEngine: "other" }),
      hasBridge: true,
      engine: "0.14.12+9c41e0",
      recording: true
    });
    expect(header).toMatchObject({ fps: "54", spikes: 6, stale: true, rec: true });
    expect(header.link.text).toBe("ADB");
  });

  it("reads — and 0 spikes without a monitor", () => {
    const header = headerView({
      second: secondOf({ state: "off", spikes: 3 }),
      status: { state: "off", reason: "no-renderer" },
      payload: undefined,
      hasBridge: false,
      engine: undefined,
      recording: false
    });
    expect(header).toMatchObject({ fps: "—", spikes: 0, stale: false, rec: false });
  });

  it("reads idle and for how long while the screen rests, instead of the fps (bug: 2 fps on a still screen)", () => {
    const input = {
      second: secondOf(),
      status: { state: "on", lost: 0, gpuTimer: true } as const,
      payload: undefined,
      hasBridge: false,
      engine: undefined,
      recording: false
    };
    const idle = headerView({ ...input, idleFor: "12s" });
    expect(idle).toMatchObject({ fps: "idle", fpsUnit: "12s" });
    expect(pillLabel(idle)).toBe("idle 12s, 6 spikes, 6 s. Open the overlay");
    expect(headerView({ ...input, idleFor: "" })).toMatchObject({ fps: "idle", fpsUnit: "" });
    expect(headerView(input)).toMatchObject({ fps: "54", fpsUnit: "fps" });
  });

  it("names fps and spikes in the pill's label", () => {
    const header = headerView({
      second: secondOf(),
      status: { state: "on", lost: 0, gpuTimer: true },
      payload: undefined,
      hasBridge: false,
      engine: undefined,
      recording: false
    });
    expect(pillLabel(header)).toBe("54 fps, 6 spikes, 6 s. Open the overlay");
  });
});

describe("profileText and engineLine", () => {
  it("a dev page reads debug, read-only (it reads dev page)", () => {
    expect(profileText("dev")).toBe("dev page");
    expect(profileText("full")).toBe("debug, full control");
    expect(profileText("read")).toBe("debug, read-only");
    expect(profileText("none")).toBe("no agent flags");
  });

  it("names unknown engine and build", () => {
    expect(engineLine({ profile: "none" }, false)).toEqual({
      engine: "unknown",
      build: "—",
      profile: "no agent flags",
      stale: false
    });
    expect(engineLine({ profile: "read", id: "debug-1", engine: "0.14.12" }, true)).toEqual({
      engine: "0.14.12",
      build: "debug-1",
      profile: "debug, read-only",
      stale: true
    });
  });
});
