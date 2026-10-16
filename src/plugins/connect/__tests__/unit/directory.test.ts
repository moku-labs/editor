/* eslint-disable unicorn/no-null -- null is "none" on the wire */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedDevice } from "../../../hub/types";
import type { DirectoryInput } from "../../directory";
import { buildDirectory, refreshDirectory } from "../../directory";
import type { WireRecord } from "../../types";
import { a26Device, createCtx, deviceSession, LISTEN, publishedOf, SERIAL } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C4: the pure buildDirectory (phases, the model match, the linked
// entries' sessions) and its throttled publish.
// ─────────────────────────────────────────────────────────────────────────────

/** Device mode came on at this time. */
const ON_AT = 1_000_000;

/**
 * A ready phone record.
 *
 * @param serial - The serial.
 * @param model - Its getprop model.
 * @param overrides - Fields to change.
 * @returns The record.
 */
function phone(serial: string, model: string, overrides: Partial<WireRecord> = {}): WireRecord {
  return {
    serial,
    state: "device",
    transport: "usb",
    facts: { model, name: "Galaxy A26", os: "Android 15" },
    asked: true,
    readySince: ON_AT - 5000,
    ...overrides
  };
}

/**
 * The input of buildDirectory with device mode on by connect.
 *
 * @param overrides - Fields to change.
 * @returns The input.
 */
function input(overrides: Partial<DirectoryInput> = {}): DirectoryInput {
  return {
    mode: { on: true, owner: "connect", listen: LISTEN },
    modeSince: ON_AT,
    adb: { available: true, reason: undefined },
    wire: [phone(SERIAL, "SM-A266B")],
    asking: [],
    linked: [],
    sessions: [],
    now: ON_AT + 1000,
    answerTimeoutMs: 20_000,
    ...overrides
  };
}

describe("buildDirectory", () => {
  it("moves a phone ready → waiting → no-agent at answerTimeoutMs → linked on a model match", () => {
    const off = { on: false, owner: null, listen: null } as const;
    const phaseOf = (built: ReturnType<typeof buildDirectory>) => [
      built.wire[0]?.phase,
      built.wire[0]?.device
    ];

    expect(phaseOf(buildDirectory(input({ mode: off, modeSince: undefined })))).toEqual([
      "ready",
      null
    ]);
    expect(phaseOf(buildDirectory(input({ now: ON_AT + 19_999 })))).toEqual(["waiting", null]);
    expect(phaseOf(buildDirectory(input({ now: ON_AT + 20_000 })))).toEqual(["no-agent", null]);
    expect(phaseOf(buildDirectory(input({ linked: [a26Device()] })))).toEqual(["linked", "d-7f3a"]);
    expect(buildDirectory(input({ linked: [a26Device()] })).wire[0]).toEqual({
      serial: SERIAL,
      state: "device",
      transport: "usb",
      model: "SM-A266B",
      name: "Galaxy A26",
      os: "Android 15",
      phase: "linked",
      device: "d-7f3a"
    });
  });

  it("counts a phone plugged after device mode came on from its own ready time", () => {
    const late = phone(SERIAL, "SM-A266B", { readySince: ON_AT + 15_000 });
    expect(buildDirectory(input({ wire: [late], now: ON_AT + 25_000 })).wire[0]?.phase).toBe(
      "waiting"
    );
  });

  it("reads unauthorized and offline from adb, and matches only online adb devices", () => {
    const wire = [
      phone("RZ8T20QWERT", "SM-A256B", { state: "unauthorized", facts: undefined }),
      phone("emulator-5554", "SDK", { state: "offline" }),
      phone(SERIAL, "SM-A266B")
    ];
    const linked: LinkedDevice[] = [
      a26Device({ online: false }),
      a26Device({ id: "d-9c1b", link: "lan", address: "192.168.1.23" })
    ];
    const built = buildDirectory(input({ wire, linked, now: ON_AT + 30_000 }));
    expect(built.wire.map(device => [device.serial, device.phase, device.model])).toEqual([
      ["R5CX30ABCDE", "no-agent", "SM-A266B"],
      ["RZ8T20QWERT", "unauthorized", null],
      ["emulator-5554", "offline", "SDK"]
    ]);
  });

  it("calls two linked phones of one model ambiguous and links neither", () => {
    // Bug: telemetry of the wrong phone.
    const wire = [phone(SERIAL, "SM-A266B"), phone("R5CX30ZZZZZ", "SM-A266B")];
    const linked = [a26Device(), a26Device({ id: "d-2b2b" })];
    const built = buildDirectory(input({ wire, linked }));
    expect(built.wire.map(device => [device.phase, device.device, device.match])).toEqual([
      ["linked", null, "ambiguous"],
      ["linked", null, "ambiguous"]
    ]);
    const twoPhonesOneLink = buildDirectory(input({ wire, linked: [a26Device()] }));
    expect(twoPhonesOneLink.wire.every(device => device.match === "ambiguous")).toBe(true);
  });

  it("gives a linked entry its open session id, and null once that session closed", () => {
    // Bug: "Use" choosing a session that is gone, or the panel unable to switch to a linked phone.
    const device = a26Device();
    const open = buildDirectory(input({ linked: [device], sessions: [deviceSession(device)] }));
    expect(open.linked).toEqual([
      {
        id: "d-7f3a",
        model: "SM-A266B",
        link: "adb",
        address: "127.0.0.1",
        online: true,
        engine: "0.15.0+9c41e0",
        build: "debug-20261016T090000Z",
        latencyMs: 9,
        session: "s-9"
      }
    ]);
    const away = buildDirectory(input({ linked: [{ ...device, online: false }], sessions: [] }));
    expect(away.linked[0]?.session).toBeNull();
  });

  it("says where a LAN pairing is confirmed, and carries adb's state", () => {
    expect(buildDirectory(input()).confirmIn).toBe("page");
    expect(
      buildDirectory(input({ mode: { on: true, owner: "other", listen: LISTEN } })).confirmIn
    ).toBe("terminal");
    const off = buildDirectory(
      input({
        mode: { on: false, owner: null, listen: null },
        adb: { available: false, reason: "missing" }
      })
    );
    expect([off.confirmIn, off.adb, off.mode]).toEqual([
      null,
      { available: false, reason: "missing" },
      { on: false, owner: null, listen: null }
    ]);
  });
});

describe("refreshDirectory", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes only on change and at most every 250 ms", async () => {
    // Bug: 4 identical publishes a second to every tab.
    const ctx = createCtx();
    refreshDirectory(ctx);
    refreshDirectory(ctx);
    expect(publishedOf(ctx.hub, "devices")).toHaveLength(1);

    ctx.state.wire.set(SERIAL, phone(SERIAL, "SM-A266B"));
    refreshDirectory(ctx);
    ctx.state.wire.set("R5CX30ZZZZZ", phone("R5CX30ZZZZZ", "SM-A266B"));
    refreshDirectory(ctx);
    expect(publishedOf(ctx.hub, "devices")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(250);
    const published = publishedOf(ctx.hub, "devices");
    expect(published).toHaveLength(2);
    expect(published[1]?.wire).toHaveLength(2);

    await vi.advanceTimersByTimeAsync(1000);
    expect(publishedOf(ctx.hub, "devices")).toHaveLength(2);
  });
});
