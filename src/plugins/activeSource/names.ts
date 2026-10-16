/**
 * @file activeSource plugin — names and kinds (spec 11 § 4 B1, B9), pure: what kind of source a
 * session is, how a device is named (the directory's marketing name, else its model, else "the
 * device"), and what the connection bar says about the source.
 */
/* eslint-disable unicorn/no-null -- the spec's "none" in the source and label types */
import type { DeviceDirectory } from "../connect/protocol";
import type { SessionDevice } from "../hub/protocol";
import type { SessionInfo } from "../registry/protocol";
import type { ActiveSource, SourceLabel } from "./types";

/**
 * The name of a device nobody named.
 */
export const UNNAMED = "the device";

/**
 * The name the connection bar gives the local preview.
 */
export const LOCAL_NAME = "Local preview";

/**
 * The source a session is (B1): a session with a device is a device; this page's own frame
 * session is the local preview; any other is another page.
 *
 * @param session - A session of link.sessions().
 * @param own - link.ownSession().
 * @returns The source.
 * @example
 * ```ts
 * sourceOf({ id: "s-1", game: "g", page: "p", embedded: true, connectedAt: 1 }, "s-1"); // { kind: "local", session: "s-1" }
 * ```
 */
export function sourceOf(session: SessionInfo, own: string | undefined): ActiveSource {
  if (session.device !== undefined) {
    return { kind: "device", session: session.id, device: session.device };
  }
  return session.id === own
    ? { kind: "local", session: session.id }
    : { kind: "page", session: session.id };
}

/**
 * The name of a device (B9): the marketing name of the phone adb matched to it, else its model,
 * else "the device".
 *
 * @param device - The device id and model.
 * @param device.id - The device id.
 * @param device.model - The normalized model.
 * @param directory - connect's directory, when one arrived.
 * @returns The name.
 * @example
 * ```ts
 * nameOf({ id: "d-7f3a", model: "SM-A266B" }, undefined); // "SM-A266B"
 * ```
 */
export function nameOf(
  device: { readonly id: string; readonly model: string | null },
  directory: DeviceDirectory | undefined
): string {
  const matched = directory?.wire.find(phone => phone.device === device.id && phone.name !== null);
  return matched?.name ?? device.model ?? UNNAMED;
}

/**
 * A text with its first letter upper case, for a name at the start of a sentence.
 *
 * @param text - The text.
 * @returns The text, capitalized.
 * @example
 * ```ts
 * sentence("the device connected"); // "The device connected"
 * ```
 */
export function sentence(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * How the connection bar names a device's link: by wire over adb, or on the network.
 *
 * @param device - The device.
 * @returns The link part of the label.
 * @example
 * ```ts
 * linkOf({ id: "d-7f3a", model: "SM-A266B", link: "lan", address: "192.168.1.23", port: 47600, engine: null, build: null });
 * // { kind: "network", transport: "lan", address: "192.168.1.23" }
 * ```
 */
function linkOf(device: SessionDevice): SourceLabel["link"] {
  return device.link === "adb"
    ? { kind: "wire", transport: "adb", address: device.address }
    : { kind: "network", transport: "lan", address: device.address };
}

/**
 * What the connection bar names: the source's display name, model, kind and link. Another page is
 * named by its game.
 *
 * @param source - The active source.
 * @param directory - connect's directory, when one arrived.
 * @param sessions - link.sessions(), for the game of another page.
 * @returns The label.
 * @example
 * ```ts
 * labelOf({ kind: "local", session: "s-1" }, undefined, []);
 * // { name: "Local preview", model: null, kind: "local", link: { kind: "local", transport: "frame", address: null } }
 * ```
 */
export function labelOf(
  source: ActiveSource,
  directory: DeviceDirectory | undefined,
  sessions: readonly SessionInfo[]
): SourceLabel {
  if (source.kind === "device") {
    const { device } = source;
    return {
      name: nameOf(device, directory),
      model: device.model,
      kind: "device",
      link: linkOf(device)
    };
  }
  const local = { kind: "local", transport: "frame", address: null } as const;
  if (source.kind === "local") return { name: LOCAL_NAME, model: null, kind: "local", link: local };

  const game = sessions.find(session => session.id === source.session)?.game;
  return { name: game ?? "Another page", model: null, kind: "page", link: local };
}
