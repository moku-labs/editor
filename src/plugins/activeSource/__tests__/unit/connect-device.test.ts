/* eslint-disable unicorn/no-null -- null is a JSON value on the wire (device mode off, no latency) */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActiveSourceApi } from "../../api";
import { startActiveSource, stopActiveSource } from "../../lifecycle";
import type { TestCtx } from "../helpers";
import {
  createCtx,
  deviceSession,
  directoryOf,
  linkedOf,
  localSession,
  settle,
  wireOf
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// connectDevice (spec 11 § 4): device mode on for wires when off, wait for the
// phone's debug game to link, then make it the source; an honest error when
// nothing answers or the phone is not authorized.
// ─────────────────────────────────────────────────────────────────────────────

let started: TestCtx | undefined;

const OFF = { on: false, owner: null, listen: null } as const;

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
});

afterEach(() => {
  if (started !== undefined) stopActiveSource(started);
  started = undefined;
  vi.useRealTimers();
});

/**
 * A started activeSource, autoUse off, on a page whose local preview runs, with the A26 plugged in
 * and device mode off.
 *
 * @returns The ctx, the fake link and the api.
 */
function setup() {
  const made = createCtx({ autoUse: false });
  started = made.ctx;
  startActiveSource(made.ctx);
  made.link.chosen = "s-1";
  made.link.list([localSession("s-1", false)], "s-1");
  made.link.devices = directoryOf({
    mode: OFF,
    wire: [wireOf({ phase: "ready", device: null })],
    linked: []
  });
  return { ...made, api: createActiveSourceApi(made.ctx) };
}

describe("activeSource.connectDevice", () => {
  it("turns device mode on, waits for the matched linked device, then makes it the source", async () => {
    const { link, api } = setup();

    const connecting = api.connectDevice("R5CX30ABCDE");
    await settle();
    expect(link.methods()).toEqual(["connect.wire"]);
    link.publishDevices(directoryOf({ linked: [linkedOf({ session: "s-9" })] }));
    link.list([localSession("s-1", false), deviceSession("s-9")]);
    await connecting;

    expect(api.current()).toMatchObject({ kind: "device", session: "s-9" });
    expect(link.commands()).toEqual(["s-1 game.pause"]);
  });

  it("rejects with the two-line no-agent error after the answer timeout; the source stays local", async () => {
    const { api } = setup();

    const connecting = api.connectDevice("R5CX30ABCDE");
    const caught = connecting.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20_000);

    // Bug caught: the panel spinning forever on a release build.
    expect(await caught).toEqual(
      new Error(
        "[moku-editor] No debug game answered on SM-A266B.\n  Start the debug build on the phone; a release build has no agent."
      )
    );
    expect(api.current()).toEqual({ kind: "local", session: "s-1" });
  });

  it("rejects an unauthorized phone at once, without turning device mode on", async () => {
    const { link, api } = setup();
    link.devices = directoryOf({
      mode: OFF,
      wire: [wireOf({ state: "unauthorized", phase: "unauthorized", device: null })],
      linked: []
    });

    await expect(api.connectDevice("R5CX30ABCDE")).rejects.toThrow(
      "[moku-editor] Allow USB debugging on the phone.\n  Accept the prompt on its screen, then connect again."
    );
    expect(link.methods()).toEqual([]);
  });

  it("does not call connect.wire when device mode is already on", async () => {
    const { link, api } = setup();
    link.devices = directoryOf();
    link.list([localSession("s-1", false), deviceSession("s-9")]);

    await api.connectDevice("R5CX30ABCDE");

    expect(link.methods()).not.toContain("connect.wire");
    expect(api.current()).toMatchObject({ kind: "device", session: "s-9" });
  });

  it("rejects a serial the directory does not list, without turning device mode on", async () => {
    const { link, api } = setup();

    // Bug caught: Connect on a phone unplugged meanwhile spinning for 20 s.
    await expect(api.connectDevice("R5CX99GONE")).rejects.toThrow(
      '[moku-editor] activeSource.connectDevice: no phone "R5CX99GONE" in the device directory.\n  Pass a serial from directory().wire.'
    );
    expect(link.methods()).toEqual([]);
  });
});
