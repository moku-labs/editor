/* eslint-disable sonarjs/no-clear-text-protocols -- local test URLs */
import { describe, expect, it } from "vitest";
import { deviceSocketUrl, linkModeOf } from "../../connection/address";
import { LAN } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The device link's mode from the phase and the address dialled, and the
// device socket URL (pure).
// ─────────────────────────────────────────────────────────────────────────────

describe("linkModeOf", () => {
  it("shows an open socket at a loopback address as adb, any other address as lan", () => {
    expect(linkModeOf("open", "127.0.0.1:47600")).toBe("adb");
    expect(linkModeOf("open", "127.0.0.2:47600")).toBe("adb");
    expect(linkModeOf("open", "[::1]:47600")).toBe("adb");
    expect(linkModeOf("open", LAN)).toBe("lan");
  });

  it("shows an opening or pairing socket as connecting", () => {
    expect(linkModeOf("connecting", LAN)).toBe("connecting");
    expect(linkModeOf("pairing", "127.0.0.1:47600")).toBe("connecting");
  });

  it("shows idle, lost and stopped as none", () => {
    expect(linkModeOf("idle", LAN)).toBe("none");
    expect(linkModeOf("lost", "127.0.0.1:47600")).toBe("none");
    expect(linkModeOf("stopped", LAN)).toBe("none");
  });
});

describe("deviceSocketUrl", () => {
  it("dials {path}/ws with kind=agent and role=device, without credentials", () => {
    expect(deviceSocketUrl(LAN, "/__editor/hello", undefined).href).toBe(
      "ws://192.168.1.5:47600/__editor/ws?kind=agent&role=device"
    );
  });

  it("sends the device id together with the token", () => {
    expect(deviceSocketUrl(LAN, "/__editor/hello", { device: "d-7f3a", token: "t0k" }).href).toBe(
      "ws://192.168.1.5:47600/__editor/ws?kind=agent&role=device&device=d-7f3a&token=t0k"
    );
  });

  it("keeps the address for an absolute hello URL and takes only its path", () => {
    expect(
      deviceSocketUrl("127.0.0.1:47600", "http://other.local:3000/tools/__editor/hello", undefined)
        .href
    ).toBe("ws://127.0.0.1:47600/tools/__editor/ws?kind=agent&role=device");
  });

  it("dials an IPv6 address in brackets", () => {
    expect(deviceSocketUrl("[::1]:47600", "/__editor/hello", undefined).href).toBe(
      "ws://[::1]:47600/__editor/ws?kind=agent&role=device"
    );
  });
});
