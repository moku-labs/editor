/* eslint-disable sonarjs/no-hardcoded-ip -- interface addresses are the cases under test */
import { describe, expect, it } from "vitest";
import type { InterfaceAddress } from "../../device/lan";
import { lanAddressOf } from "../../device/lan";

/**
 * An IPv4 entry.
 *
 * @param address - The address.
 * @param internal - A loopback entry.
 * @returns The entry.
 */
function ipv4(address: string, internal = false): InterfaceAddress {
  return { address, family: "IPv4", internal };
}

/**
 * An IPv6 entry.
 *
 * @param address - The address.
 * @returns The entry.
 */
function ipv6(address: string): InterfaceAddress {
  return { address, family: "IPv6", internal: false };
}

describe("lanAddressOf", () => {
  it("prefers a card (en0) over a VPN tunnel listed first (bug: binding an address the phone cannot reach)", () => {
    expect(lanAddressOf({ utun3: [ipv4("10.8.0.2")], en0: [ipv4("192.168.1.5")] })).toBe(
      "192.168.1.5"
    );
    expect(lanAddressOf({ docker0: [ipv4("172.17.0.1")], wlp2s0: [ipv4("192.168.1.9")] })).toBe(
      "192.168.1.9"
    );
    expect(lanAddressOf({ tun0: [ipv4("10.8.0.2")], eth0: [ipv4("10.0.0.7")] })).toBe("10.0.0.7");
  });

  it("skips internal and IPv6-only interfaces", () => {
    expect(
      lanAddressOf({
        lo0: [ipv4("127.0.0.1", true)],
        en0: [ipv6("fe80::1")],
        en1: [ipv6("fe80::2"), ipv4("192.168.1.23")]
      })
    ).toBe("192.168.1.23");
  });

  it("falls back to any non-internal IPv4 when no card has one", () => {
    expect(lanAddressOf({ en0: [ipv6("fe80::1")], bridge100: [ipv4("192.168.64.1")] })).toBe(
      "192.168.64.1"
    );
  });

  it("answers undefined with only the loopback", () => {
    expect(lanAddressOf({ lo0: [ipv4("127.0.0.1", true), ipv6("::1")], en0: undefined })).toBe(
      undefined
    );
  });
});
