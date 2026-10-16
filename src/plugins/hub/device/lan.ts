/**
 * @file hub plugin — the LAN address of this computer for device mode's LAN listener (C2 step 1).
 * Pure: it reads the interface table it is given (`os.networkInterfaces()` in the plugin).
 */

/**
 * One address of a network interface, the part of `os.networkInterfaces()` the pick reads.
 */
export type InterfaceAddress = {
  readonly address: string;
  readonly family: string;
  readonly internal: boolean;
};

/**
 * The interface table: addresses by interface name.
 */
export type Interfaces = Readonly<Record<string, readonly InterfaceAddress[] | undefined>>;

/**
 * Name prefixes of a Wi-Fi or wired card (macOS `en0`, Linux `wlan0` / `wlp2s0`, `eth0`): their
 * addresses are tried first, so a VPN tunnel (`utun3`) a phone cannot reach is not picked.
 */
const CARD_PREFIXES: readonly string[] = ["en", "wl", "eth"];

/**
 * The first non-internal IPv4 address of the interfaces that pass a name test.
 *
 * @param interfaces - The interface table.
 * @param named - The name test.
 * @returns The address, or undefined.
 * @example
 * ```ts
 * firstIpv4({ en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }] }, () => true); // "192.168.1.5"
 * ```
 */
function firstIpv4(interfaces: Interfaces, named: (name: string) => boolean): string | undefined {
  for (const [name, addresses] of Object.entries(interfaces)) {
    if (!named(name)) continue;
    const found = addresses?.find(entry => entry.family === "IPv4" && !entry.internal);
    if (found !== undefined) return found.address;
  }
  return undefined;
}

/**
 * The LAN address device mode binds when `lanAddress` is not set: the first non-internal IPv4 of
 * an interface whose name starts with `en`, `wl` or `eth`, else the first non-internal IPv4 of any
 * interface, else undefined (only the loopback, or IPv6 only).
 *
 * @param interfaces - The interface table.
 * @returns The address, or undefined.
 * @example
 * ```ts
 * lanAddressOf({ utun3: [{ address: "10.8.0.2", family: "IPv4", internal: false }], en0: [{ address: "192.168.1.5", family: "IPv4", internal: false }] }); // "192.168.1.5"
 * ```
 */
export function lanAddressOf(interfaces: Interfaces): string | undefined {
  return (
    firstIpv4(interfaces, name => CARD_PREFIXES.some(prefix => name.startsWith(prefix))) ??
    firstIpv4(interfaces, () => true)
  );
}
