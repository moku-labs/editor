/**
 * @file bridge plugin — the device link's address rules (pure): the link mode from the phase and the
 * address dialled, and the device socket URL `ws://<address>{path}/ws?kind=agent&role=device`.
 */
import type { DeviceLink } from "../../hub/protocol";
import { isLoopback, parseAddress } from "../../hub/protocol";
import type { Phase, RememberedLink } from "../types";

/**
 * The base a relative hello route is read against: only its path is used.
 */
const PATH_BASE = "file:///";

/**
 * The link mode the overlay shows: an open socket is adb at a loopback address (adb reverse) and
 * lan at any other; an opening or pairing socket is connecting; idle, lost and stopped are none.
 *
 * @param phase - The connection phase.
 * @param address - The `host:port` dialled.
 * @returns The mode of the device link.
 * @example
 * ```ts
 * linkModeOf("open", "127.0.0.1:47600"); // "adb"
 * ```
 */
export function linkModeOf(phase: Phase, address: string): DeviceLink["mode"] {
  switch (phase) {
    case "open": {
      const host = parseAddress(address)?.host;
      return host !== undefined && isLoopback(host) ? "adb" : "lan";
    }
    case "connecting":
    case "pairing": {
      return "connecting";
    }
    default: {
      return "none";
    }
  }
}

/**
 * The socket path of device mode: the path of `hello` with its last segment replaced by `ws`
 * ("/__editor/hello" → "/__editor/ws"), the hub's `{path}/ws`.
 *
 * @param hello - config.hello: a path or an absolute URL (only its path counts).
 * @returns The socket path.
 * @example
 * ```ts
 * wsPathOf("http://other.local:3000/tools/__editor/hello"); // "/tools/__editor/ws"
 * ```
 */
function wsPathOf(hello: string): string {
  const path = new URL(hello, PATH_BASE).pathname;
  return `${path.slice(0, path.lastIndexOf("/") + 1)}ws`;
}

/**
 * The device socket URL: always `ws:` (debug builds allow cleartext), the address as dialled, the
 * hub's socket path, `kind=agent&role=device`, then the device id and the token together when
 * the device has them. No hello fetch: a device has no same-origin hello.
 *
 * @param address - The normalized `host:port`.
 * @param hello - config.hello.
 * @param credentials - The remembered device id and token for the address; none for a pairing
 *   socket.
 * @returns The socket URL.
 * @example
 * ```ts
 * deviceSocketUrl("192.168.1.5:47600", "/__editor/hello", undefined).href;
 * // "ws://192.168.1.5:47600/__editor/ws?kind=agent&role=device"
 * ```
 */
export function deviceSocketUrl(address: string, hello: string, credentials?: RememberedLink): URL {
  const url = new URL(`ws://${address}${wsPathOf(hello)}`);
  url.searchParams.set("kind", "agent");
  url.searchParams.set("role", "device");
  if (credentials !== undefined) {
    url.searchParams.set("device", credentials.device);
    url.searchParams.set("token", credentials.token);
  }
  return url;
}
