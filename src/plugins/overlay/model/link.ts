/**
 * @file overlay plugin — the Link tab's view model (C6, F3): the mode keys, the address row, the
 * pairing box, the STALE caution, the live box and the seen line. Pure.
 */
import type { DeviceLink } from "../../hub/protocol";
import { isLoopback, parseAddress } from "../../hub/protocol";
import type { RecorderStatusEvent } from "../../recorder/types";
import type { BuildInfo } from "../../registry/protocol";
import type { LinkPayload } from "../types";
import { COLOUR, groupDigits, hourMinute, secondsBetween } from "./format";
import { profileText } from "./header";
import type { AddressRow, LinkTabView, ModeKey } from "./types";

/** The hint under a bad address. */
export const ADDRESS_HINT = "Use host:port, for example 192.168.1.5:47600.";

/** The placeholder of the empty address field. */
const PLACEHOLDER = "192.168.1.5:47600";

/** The note of an agent without the bridge. */
const NO_BRIDGE = "This build has no editor link (the bridge is not in the agent).";

/** The four mode keys: kind, word, sub line, colour. */
const MODES: readonly (readonly [ModeKey["kind"], string, string, string])[] = [
  ["none", "NO PC", "on device", COLOUR.ink],
  ["connecting", "CONNECTING", "pairing", COLOUR.caution],
  ["adb", "ADB", "live, usb", COLOUR.live],
  ["lan", "LAN", "live, wi-fi", COLOUR.live]
];

/**
 * Checks the address field: `host:port`, normalized.
 *
 * @param text - The field.
 * @returns The normalized address, or undefined for a bad one.
 * @example
 * ```ts
 * checkAddress("192.168.1.5"); // undefined
 * ```
 */
export function checkAddress(text: string): string | undefined {
  return parseAddress(text)?.text;
}

/**
 * The mode keys: the current one lit (NO PC without a bridge, none on a dev page); LAN outlined
 * as the candidate while connecting to a non-loopback address.
 *
 * @param payload - The last `bridge:status`.
 * @param hasBridge - Whether the bridge is composed.
 * @returns The keys.
 */
function modeKeys(payload: LinkPayload | undefined, hasBridge: boolean): ModeKey[] {
  const link = payload?.link;
  const current = hasBridge ? link?.mode : "none";
  const host = link === undefined ? undefined : parseAddress(link.address)?.host;
  const lanCandidate = current === "connecting" && host !== undefined && !isLoopback(host);
  return MODES.map(([kind, word, sub, colour]) => ({
    kind,
    word,
    sub,
    colour,
    lit: kind === current,
    candidate: kind === "lan" && lanCandidate
  }));
}

/**
 * The address row: an empty field and Connect with no computer; the address and Pair while
 * connecting; read-only with its tag while live; disabled without a bridge; none on a dev page.
 *
 * @param payload - The last `bridge:status`.
 * @param hasBridge - Whether the bridge is composed.
 * @param draft - The field as typed; undefined = the bridge's address.
 * @returns The row, or undefined.
 */
function addressRow(
  payload: LinkPayload | undefined,
  hasBridge: boolean,
  draft: string | undefined
): AddressRow | undefined {
  const blank = { placeholder: PLACEHOLDER, readOnly: false, tag: undefined };
  if (!hasBridge) return { ...blank, value: "", action: "connect", disabled: true };

  const link = payload?.link;
  if (link === undefined) return undefined;
  if (link.mode === "adb" || link.mode === "lan") {
    const tag = link.mode === "adb" ? "via adb" : "via LAN";
    return {
      ...blank,
      value: link.address,
      readOnly: true,
      action: undefined,
      tag,
      disabled: false
    };
  }
  const connecting = link.mode === "connecting";
  return {
    ...blank,
    value: draft ?? (connecting ? link.address : ""),
    action: connecting ? "pair" : "connect",
    disabled: false
  };
}

/**
 * The live box: the dev server on a dev page; adb / LAN with the last sign of the computer and the
 * recorder's sent and pending lines; none otherwise.
 *
 * @param link - The device link (undefined on a dev page or without a bridge).
 * @param pageMode - A dev page (a bridge without a device link).
 * @param rec - The last `recorder:status`.
 * @param now - Epoch ms now.
 * @returns The live box, or undefined.
 */
function liveBoxOf(
  link: DeviceLink | undefined,
  pageMode: boolean,
  rec: RecorderStatusEvent | undefined,
  now: number
): LinkTabView["live"] {
  if (pageMode) return { title: "Live via the dev server", text: "" };
  if (link?.mode !== "adb" && link?.mode !== "lan") return undefined;

  const seen = link.seenAt === undefined ? "not yet" : `${secondsBetween(link.seenAt, now)} s ago`;
  const counts =
    rec === undefined ? "" : `, sent ${groupDigits(rec.sent)}, pending ${groupDigits(rec.pending)}`;
  return {
    title: link.mode === "adb" ? "Live via adb" : "Live via LAN",
    text: `last seen ${seen}${counts}`
  };
}

/**
 * The last-seen line (not while live): the time of the last sign, and while pairing the build and
 * the profile.
 *
 * @param link - The device link.
 * @param build - `registry.build()`.
 * @returns The seen line, or undefined.
 */
function seenOf(link: DeviceLink | undefined, build: BuildInfo): LinkTabView["seen"] {
  if (link === undefined || link.mode === "adb" || link.mode === "lan") return undefined;
  const value = link.seenAt === undefined ? "not yet" : hourMinute(link.seenAt);
  const rest =
    link.pairing === undefined ? "" : `, build ${build.id ?? "—"}, ${profileText(build.profile)}`;
  return { value, rest };
}

/**
 * The Link tab.
 *
 * @param input - The link, the recorder's counts, STALE, the field and the build.
 * @param input.payload - The last `bridge:status`.
 * @param input.hasBridge - Whether the bridge is composed.
 * @param input.rec - The last `recorder:status`.
 * @param input.stale - Whether STALE shows.
 * @param input.draft - The address field as typed.
 * @param input.error - The hint under a bad address.
 * @param input.build - `registry.build()`.
 * @param input.now - Epoch ms now.
 * @returns The Link tab view.
 */
export function linkTabView(input: {
  readonly payload: LinkPayload | undefined;
  readonly hasBridge: boolean;
  readonly rec: RecorderStatusEvent | undefined;
  readonly stale: boolean;
  readonly draft: string | undefined;
  readonly error: string | undefined;
  readonly build: BuildInfo;
  readonly now: number;
}): LinkTabView {
  const { payload, hasBridge } = input;
  const link = hasBridge ? payload?.link : undefined;
  const editorEngine = link?.editorEngine;
  return {
    keys: modeKeys(payload, hasBridge),
    address: addressRow(payload, hasBridge, input.draft),
    error: input.error,
    pairing: link?.pairing?.code,
    caution:
      input.stale && editorEngine !== undefined
        ? { phone: input.build.engine ?? "unknown", computer: editorEngine }
        : undefined,
    live: liveBoxOf(link, hasBridge && link === undefined, input.rec, input.now),
    engineInline: link?.mode === "adb" || link?.mode === "lan",
    seen: seenOf(link, input.build),
    note: hasBridge ? undefined : NO_BRIDGE
  };
}
