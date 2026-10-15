// @vitest-environment happy-dom
/* eslint-disable sonarjs/no-hardcoded-ip -- addresses a phone types into the Link tab */
import { describe, expect, it } from "vitest";
import { connectLink } from "../../actions";
import { ADDRESS_HINT, linkTabView } from "../../model/link";
import type { LinkPayload } from "../../types";
import { createOctx } from "../helpers";

const NOW = new Date(2026, 9, 14, 14, 2, 30).getTime();

/**
 * A device-mode payload.
 *
 * @param link - The device link.
 * @returns The payload.
 */
function device(link: NonNullable<LinkPayload["link"]>): LinkPayload {
  return { status: { kind: "live", frame: 1 }, link };
}

/**
 * The link tab view of a phone with a bridge.
 *
 * @param extra - Inputs to replace.
 * @returns The view.
 */
function view(extra: Partial<Parameters<typeof linkTabView>[0]> = {}) {
  return linkTabView({
    payload: device({ mode: "none", address: "127.0.0.1:47600" }),
    hasBridge: true,
    rec: { state: "recording", lines: 1840, bytes: 412_000, sent: 1790, pending: 50 },
    stale: false,
    draft: undefined,
    error: undefined,
    build: { profile: "read", id: "debug-20261014T160000Z", engine: "0.14.12+9c41e0" },
    now: NOW,
    ...extra
  });
}

describe("linkTabView", () => {
  it("lights the current mode key", () => {
    const keys = view({
      payload: device({ mode: "adb", address: "127.0.0.1:47600", seenAt: NOW - 1000 })
    }).keys;
    expect(keys.map(key => [key.word, key.sub, key.lit, key.candidate])).toEqual([
      ["NO PC", "on device", false, false],
      ["CONNECTING", "pairing", false, false],
      ["ADB", "live, usb", true, false],
      ["LAN", "live, wi-fi", false, false]
    ]);
  });

  it("outlines LAN as the candidate while connecting to a LAN address", () => {
    const keys = view({
      payload: device({ mode: "connecting", address: "192.168.1.5:47600" })
    }).keys;
    expect(keys.map(key => [key.lit, key.candidate])).toEqual([
      [false, false],
      [true, false],
      [false, false],
      [false, true]
    ]);
  });

  it("none: an empty field with the placeholder and Connect", () => {
    expect(view().address).toEqual({
      value: "",
      placeholder: "192.168.1.5:47600",
      readOnly: false,
      action: "connect",
      tag: undefined,
      disabled: false
    });
  });

  it("connecting: the address and Pair; adb / lan: read-only with the tag", () => {
    expect(
      view({ payload: device({ mode: "connecting", address: "192.168.1.5:47600" }) }).address
    ).toMatchObject({
      value: "192.168.1.5:47600",
      action: "pair",
      readOnly: false
    });
    expect(
      view({ payload: device({ mode: "lan", address: "192.168.1.5:47600" }) }).address
    ).toMatchObject({
      value: "192.168.1.5:47600",
      readOnly: true,
      action: undefined,
      tag: "via LAN"
    });
    expect(view({ draft: "10.0.0.2:47600" }).address?.value).toBe("10.0.0.2:47600");
  });

  it("the pairing box shows after paired (only while pairing)", () => {
    expect(
      view({
        payload: device({
          mode: "connecting",
          address: "192.168.1.5:47600",
          pairing: { code: "4821" }
        })
      }).pairing
    ).toBe("4821");
    expect(
      view({ payload: device({ mode: "lan", address: "192.168.1.5:47600" }) }).pairing
    ).toBeUndefined();
  });

  it("the live box shows while pairing (only adb or lan)", () => {
    const pairing = view({
      payload: device({
        mode: "connecting",
        address: "192.168.1.5:47600",
        pairing: { code: "4821" }
      })
    });
    expect(pairing.live).toBeUndefined();
    expect(pairing.seen).toEqual({
      value: "not yet",
      rest: ", build debug-20261014T160000Z, debug, read-only"
    });
    const live = view({
      payload: device({ mode: "adb", address: "127.0.0.1:47600", seenAt: NOW - 1000 })
    });
    expect(live.live).toEqual({
      title: "Live via adb",
      text: "last seen 1 s ago, sent 1 790, pending 50"
    });
    expect(live.engineInline).toBe(true);
    expect(live.seen).toBeUndefined();
  });

  it("names the last sign of the computer", () => {
    expect(
      view({ payload: device({ mode: "none", address: "a:1", seenAt: NOW - 30_000 }) }).seen
    ).toEqual({
      value: "14:02",
      rest: ""
    });
  });

  it("shows the STALE caution with both engines", () => {
    expect(
      view({
        stale: true,
        payload: device({ mode: "none", address: "a:1", editorEngine: "0.14.13+1ab7f2" })
      }).caution
    ).toEqual({
      phone: "0.14.12+9c41e0",
      computer: "0.14.13+1ab7f2"
    });
  });

  it("the no-bridge state leaves Connect enabled", () => {
    const tab = view({ hasBridge: false, payload: undefined });
    expect(tab.keys.map(key => key.lit)).toEqual([true, false, false, false]);
    expect(tab.address).toMatchObject({ disabled: true, action: "connect" });
    expect(tab.note).toBe("This build has no editor link (the bridge is not in the agent).");
  });

  it("page mode: no key lit and the dev server live box", () => {
    const tab = view({ payload: { status: { kind: "live", frame: 3 } } });
    expect(tab.keys.every(key => !key.lit)).toBe(true);
    expect(tab.live).toEqual({ title: "Live via the dev server", text: "" });
    expect(tab.address).toBeUndefined();
  });
});

describe("connectLink", () => {
  it("Connect with 192.168.1.5 emits overlay:connect (it shows the hint, emits nothing)", () => {
    const octx = createOctx();
    octx.state.hasBridge = true;
    octx.state.addressDraft = "192.168.1.5";
    connectLink(octx);
    expect(octx.emitted).toEqual([]);
    expect(octx.state.addressError).toBe(ADDRESS_HINT);
    expect(ADDRESS_HINT).toBe("Use host:port, for example 192.168.1.5:47600.");
  });

  it("emits the normalized address of a good field and clears the hint", () => {
    const octx = createOctx();
    octx.state.hasBridge = true;
    octx.state.addressError = ADDRESS_HINT;
    octx.state.addressDraft = " 192.168.1.5:47600 ";
    connectLink(octx);
    expect(octx.emitted).toEqual([["overlay:connect", { address: "192.168.1.5:47600" }]]);
    expect(octx.state.addressError).toBeUndefined();
  });

  it("pairs with the bridge's address when the field was not touched", () => {
    const octx = createOctx();
    octx.state.hasBridge = true;
    octx.state.link = device({ mode: "connecting", address: "192.168.1.9:47600" });
    connectLink(octx);
    expect(octx.emitted).toEqual([["overlay:connect", { address: "192.168.1.9:47600" }]]);
  });

  it("does nothing without a bridge", () => {
    const octx = createOctx();
    octx.state.addressDraft = "192.168.1.5:47600";
    connectLink(octx);
    expect(octx.emitted).toEqual([]);
  });
});
