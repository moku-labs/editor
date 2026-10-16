/* eslint-disable sonarjs/no-hardcoded-ip -- test data: the LAN address of a phone */
/* eslint-disable unicorn/no-null -- null is "none" in the device directory */
import { describe, expect, it } from "vitest";
import {
  askingRow,
  cableRow,
  cableRowText,
  connectedAlert,
  defaultTab,
  IPHONE_LINE,
  linkedRow,
  networkView,
  splitMenu
} from "../../derive/connect";
import type {
  ActiveSource,
  DeviceDirectory,
  LinkedEntry,
  PairAsk,
  WireDevice
} from "../../source/contract";
import { DEVICE } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/connect.ts (spec 09 § M7 Connect panel, spec 11 § 0): the rows and the
// honest v1 texts of the Connect panel.
// ─────────────────────────────────────────────────────────────────────────────

const PHONE: WireDevice = {
  serial: "R5CX30ABCDE",
  state: "device",
  transport: "usb",
  model: "SM-A266B",
  name: "Galaxy A26",
  os: "Android 15",
  phase: "ready",
  device: null
};

const LINKED: LinkedEntry = {
  id: "d-7f3a",
  model: "SM-A266B",
  link: "adb",
  address: "127.0.0.1",
  online: true,
  engine: null,
  build: null,
  latencyMs: 9.2,
  session: "s-9"
};

const ASK: PairAsk = {
  ticket: "p-3a1f",
  model: "SM-A266B",
  address: "192.168.1.23",
  link: "lan",
  engine: null,
  build: null,
  since: 1
};

const SOURCE: ActiveSource = { kind: "device", session: "s-9", device: DEVICE };

/**
 * A directory.
 *
 * @param overrides - Field overrides.
 * @returns The directory.
 */
function directoryOf(overrides: Partial<DeviceDirectory> = {}): DeviceDirectory {
  return {
    v: 1,
    mode: { on: false, owner: null, listen: null },
    confirmIn: "page",
    adb: { available: true },
    wire: [],
    asking: [],
    linked: [],
    at: 1,
    ...overrides
  };
}

describe("By wire", () => {
  it("an unauthorized phone reads 'Allow USB debugging on the phone'; no-agent is disabled with 'Release build: no agent'", () => {
    // Bug: a release build offered "Connect" that can never answer.
    expect(cableRowText({ ...PHONE, phase: "unauthorized" })).toBe(
      "Allow USB debugging on the phone (a prompt is on its screen)"
    );
    const release = cableRow({ ...PHONE, phase: "no-agent" }, undefined, []);
    expect(release).toMatchObject({
      disabled: true,
      action: { kind: "tag", text: "Release build: no agent", tone: "warn" }
    });
    expect(cableRow(PHONE, undefined, []).action).toEqual({ kind: "connect" });
    expect(cableRow({ ...PHONE, phase: "waiting" }, undefined, []).action).toEqual({
      kind: "spinner",
      text: "Waiting for the game…"
    });
  });

  it("a wireless adb serial reads 'over Wi-Fi debugging'; a linked phone reads Connected when it is the source, else Use", () => {
    // Bug: "Use" on the phone already shown, or a Wi-Fi phone described as on USB.
    expect(cableRow({ ...PHONE, transport: "wifi" }, undefined, []).sub).toBe(
      "SM-A266B, Android 15, over Wi-Fi debugging"
    );
    const linked = { ...PHONE, phase: "linked" as const, device: "d-7f3a" };
    expect(cableRow(linked, SOURCE, [LINKED]).action).toEqual({
      kind: "tag",
      text: "Connected",
      tone: "ok"
    });
    expect(cableRow(linked, { kind: "local", session: "s-1" }, [LINKED]).action).toEqual({
      kind: "use",
      session: "s-9"
    });
    expect(cableRow({ ...PHONE, match: "ambiguous" }, undefined, []).action).toMatchObject({
      tone: "warn"
    });
  });

  it("the By wire tab always shows the iPhone line, never a by-cable promise", () => {
    // Bug: an iPhone column that promises a cable connection v1 cannot make.
    expect(IPHONE_LINE).toBe(
      "iPhone and iPad: not available yet. There is no iOS debug build to link."
    );
    expect(defaultTab(directoryOf({ wire: [PHONE] }))).toBe("wire");
    expect(defaultTab(directoryOf())).toBe("network");
  });
});

describe("On the network", () => {
  it("LAN off shows 'Listen on the network', on shows the address and 'Waiting for a phone to dial …'", () => {
    // Bug: the prototype's scan text claiming a LAN scan the editor does not do.
    expect(networkView(directoryOf())).toEqual({
      kind: "listen",
      note: "The phone dials this computer; nothing is scanned."
    });
    const listening = networkView(
      directoryOf({
        mode: {
          on: true,
          owner: "connect",
          listen: { port: 47_600, adb: "127.0.0.1:47600", lan: "192.168.1.5:47600" }
        }
      })
    );
    expect(listening).toMatchObject({
      kind: "listening",
      address: "192.168.1.5:47600",
      waiting: "Waiting for a phone to dial 192.168.1.5:47600"
    });
    expect(JSON.stringify(listening)).not.toMatch(/scan/i);
  });

  it("confirmIn terminal shows no code input", () => {
    // Bug: a code typed on the page that perf's terminal owns.
    expect(askingRow(ASK, "page")).toEqual({
      ticket: "p-3a1f",
      title: "SM-A266B at 192.168.1.23",
      sub: "type the code on its screen",
      input: true
    });
    expect(askingRow(ASK, "terminal")).toMatchObject({
      input: false,
      sub: "Confirm in the terminal that runs moku-editor perf"
    });
  });
});

describe("Linked devices and the menu", () => {
  it("Linked rows read 'In use' for the current source, Use otherwise, away without a session", () => {
    // Bug: "Use" offered for the phone in use, or for a phone away (no session to choose).
    expect(linkedRow(LINKED, SOURCE)).toMatchObject({
      action: { kind: "in-use" },
      latency: "9 ms",
      how: "by wire"
    });
    expect(linkedRow(LINKED, undefined).action).toEqual({ kind: "use", session: "s-9" });
    expect(linkedRow({ ...LINKED, session: null, link: "lan" }, undefined)).toMatchObject({
      action: undefined,
      latency: "away",
      how: "on the network"
    });
  });

  it("the split menu offers By wire, On the network and, when phones are linked, Linked devices; the success alert names the phone", () => {
    // Bug: a Linked devices item leading to an empty list.
    expect(splitMenu(directoryOf()).map(item => item.label)).toEqual(["By wire", "On the network"]);
    expect(splitMenu(directoryOf({ linked: [LINKED] })).map(item => item.id)).toEqual([
      "wire",
      "network",
      "linked"
    ]);
    expect(connectedAlert("Galaxy A26")).toEqual({
      strong: "Connected to Galaxy A26.",
      rest: "The local preview is paused. Every card now shows Galaxy A26.",
      toast: "Galaxy A26 connected. The local preview is paused."
    });
  });
});
