/**
 * @file bridge plugin — the remembered links in `localStorage["moku-editor:link"]`: read (v1 only,
 * every entry checked), write (a throwing store keeps the links in memory), remember a pairing
 * (at most MAX_REMEMBERED addresses, the oldest dropped) and forget one. Tokens are never logged.
 */
import { parseAddress } from "../../hub/protocol";
import type { BridgeDeps, RememberedLink, RememberedLinks } from "../types";
import { MAX_REMEMBERED, PAIRING_STORE_KEY } from "../types";

/**
 * Nothing remembered (a fresh object each time: the links are mutated in place).
 *
 * @returns The empty links.
 * @example
 * ```ts
 * emptyRemembered(); // { v: 1, last: undefined, links: {} }
 * ```
 */
export function emptyRemembered(): RememberedLinks {
  return { v: 1, last: undefined, links: {} };
}

/**
 * The normalized address of a stored key, or undefined.
 *
 * @param value - A stored value.
 * @returns The address text.
 * @example
 * ```ts
 * addressOf(" 192.168.1.5:47600 "); // "192.168.1.5:47600"
 * ```
 */
function addressOf(value: unknown): string | undefined {
  return typeof value === "string" ? parseAddress(value)?.text : undefined;
}

/**
 * A stored link: a device id and a token, both non-empty strings.
 *
 * @param value - A stored value.
 * @returns The link, or undefined.
 * @example
 * ```ts
 * linkOf({ device: "d-7f3a", token: "t1" }); // { device: "d-7f3a", token: "t1" }
 * ```
 */
function linkOf(value: unknown): RememberedLink | undefined {
  if (typeof value !== "object" || value === null) return undefined;
  if (!("device" in value) || !("token" in value)) return undefined;
  const { device, token } = value;
  return typeof device === "string" && device !== "" && typeof token === "string" && token !== ""
    ? { device, token }
    : undefined;
}

/**
 * Reads the stored text: `v: 1`, a valid last address, and the links whose address and
 * credentials are valid, the newest MAX_REMEMBERED.
 *
 * @param text - The stored JSON text; null or undefined when there is none.
 * @returns The links; nothing remembered for anything else.
 * @example
 * ```ts
 * parseRemembered('{"v":2,"last":"192.168.1.5:47600","links":{}}'); // { v: 1, last: undefined, links: {} }
 * ```
 */
function parseRemembered(text: string | null | undefined): RememberedLinks {
  const remembered = emptyRemembered();
  if (typeof text !== "string") return remembered;
  const stored: unknown = JSON.parse(text);
  if (typeof stored !== "object" || stored === null) return remembered;
  if (!("v" in stored) || stored.v !== 1) return remembered;

  if ("last" in stored) remembered.last = addressOf(stored.last);
  const links = "links" in stored && typeof stored.links === "object" ? stored.links : undefined;
  for (const [key, value] of Object.entries(links ?? {})) {
    const address = addressOf(key);
    const link = linkOf(value);
    if (address !== undefined && link !== undefined) remembered.links[address] = link;
  }
  return capped(remembered);
}

/**
 * The links with at most MAX_REMEMBERED addresses: the oldest (first inserted) are dropped.
 *
 * @param remembered - The links.
 * @returns The same object, trimmed.
 * @example
 * ```ts
 * Object.keys(capped(fiveLinks).links).length; // 4
 * ```
 */
function capped(remembered: RememberedLinks): RememberedLinks {
  const addresses = Object.keys(remembered.links);
  for (const address of addresses.slice(0, Math.max(addresses.length - MAX_REMEMBERED, 0))) {
    Reflect.deleteProperty(remembered.links, address);
  }
  return remembered;
}

/**
 * Reads the remembered links from the page's localStorage. A missing store or another version:
 * nothing remembered. A throw (storage off, a broken text) is logged at debug.
 *
 * @param deps - The link storage and the log.
 * @returns The links.
 */
export function readRemembered(deps: Pick<BridgeDeps, "linkStorage" | "log">): RememberedLinks {
  try {
    return parseRemembered(deps.linkStorage?.getItem(PAIRING_STORE_KEY));
  } catch {
    deps.log.debug("bridge:storage-failed", { step: "read" });
    return emptyRemembered();
  }
}

/**
 * Writes the remembered links of the state; a throwing store keeps them in memory for the page's
 * life and logs at debug (never the links).
 *
 * @param deps - The state, the link storage and the log.
 */
export function writeRemembered(deps: Pick<BridgeDeps, "state" | "linkStorage" | "log">): void {
  try {
    deps.linkStorage?.setItem(PAIRING_STORE_KEY, JSON.stringify(deps.state.remembered));
  } catch {
    deps.log.debug("bridge:storage-failed", { step: "write" });
  }
}

/**
 * The links after a pairing: the address's credentials as the newest entry, the address as the
 * last one, at most MAX_REMEMBERED addresses.
 *
 * @param remembered - The links before.
 * @param address - The normalized address.
 * @param link - The device id and token from `paired`.
 * @returns New links.
 * @example
 * ```ts
 * rememberLink({ v: 1, last: undefined, links: {} }, "192.168.1.5:47600", { device: "d-7f3a", token: "t1" }).last;
 * // "192.168.1.5:47600"
 * ```
 */
export function rememberLink(
  remembered: RememberedLinks,
  address: string,
  link: RememberedLink
): RememberedLinks {
  const links = { ...remembered.links };
  Reflect.deleteProperty(links, address);
  links[address] = link;
  return capped({ v: 1, last: address, links });
}

/**
 * The links without an address's credentials (the hub closed them 4401 `unpaired`).
 *
 * @param remembered - The links before.
 * @param address - The normalized address.
 * @returns New links; `last` unchanged.
 * @example
 * ```ts
 * forgetLink({ v: 1, last: "192.168.1.5:47600", links: { "192.168.1.5:47600": { device: "d-7f3a", token: "t1" } } }, "192.168.1.5:47600").links;
 * // {}
 * ```
 */
export function forgetLink(remembered: RememberedLinks, address: string): RememberedLinks {
  const links = { ...remembered.links };
  Reflect.deleteProperty(links, address);
  return { v: 1, last: remembered.last, links };
}
