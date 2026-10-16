/* eslint-disable unicorn/no-null -- null is "not reported" in the parsers' answers */
/**
 * @file connect plugin — the pure parsers of adb's answers: the phones of `adb devices -l`, the
 * facts of getprop, the devtools sockets of /proc/net/unix, the processes of `ps`, the sections of
 * a multi-file `head`, and the port `adb forward tcp:0` printed. Every command they read is a read.
 */
import { normalizeModel } from "../../hub/protocol";
import type { DeviceFacts, HeadRead, ListedDevice, PsProcess, WireDevice } from "../types";

/** The serial of an Android 11+ wireless-debugging phone found over mDNS, and its USB serial. */
const TLS_SERIAL = /^adb-(.+)-[^-]+\._adb-tls-connect\._tcp\.?$/;

/** An `ip:port` serial (`adb connect`). */
const IP_SERIAL = /^[\d.]+:\d+$/;

/** One `[key]: [value]` line of getprop. */
const PROP = /^\[([^\]]+)\]: \[(.*)\]$/;

/** The devtools socket names, as /proc/net/unix lists them (abstract, with "@"). */
const DEVTOOLS = /^@(webview_devtools_remote_\d{1,7}|chrome_devtools_remote)$/;

/** One process line of `ps -A -o PID,NAME`. */
const PS_LINE = /^\s*(\d+)\s+(\S.*)$/;

/** A section header of a multi-file `head`. */
const SECTION = /^==> (.+) <==$/;

/** A file `head` could not read, when an old adb merges stderr into stdout. */
const HEAD_ERROR = /^head: (.+?): (.+)$/;

/** The port line of `adb forward tcp:0`. */
const PORT = /^\d{1,5}$/;

/** The adb states connect knows; any other reads "other". */
const STATES: readonly WireDevice["state"][] = ["device", "unauthorized", "offline"];

/** The longest name kept from getprop. */
const MAX_NAME = 64;

/** C0, DEL, C1, and the bidi controls U+202A–U+202E and U+2066–U+2069. */
const UNSAFE: readonly [number, number][] = [
  [0x00, 0x1f],
  [0x7f, 0x9f],
  [0x20_2a, 0x20_2e],
  [0x20_66, 0x20_69]
];

/**
 * Whether a character is a control or bidi character.
 *
 * @param char - One character.
 * @returns True for an unsafe character.
 * @example
 * ```ts
 * isUnsafe("‮"); // true
 * ```
 */
function isUnsafe(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return UNSAFE.some(([low, high]) => code >= low && code <= high);
}

/**
 * Text a phone reported, cleaned for the page: control and bidi characters dropped, trimmed, at
 * most 64 characters; empty gives null.
 *
 * @param raw - The text.
 * @returns The clean text, or null.
 * @example
 * ```ts
 * cleanText(" Galaxy A26‮ "); // "Galaxy A26"
 * ```
 */
function cleanText(raw: string | undefined): string | null {
  const kept = [...(raw ?? "")].filter(char => !isUnsafe(char)).join("");
  const text = kept.trim().slice(0, MAX_NAME);
  return text === "" ? null : text;
}

/**
 * The transport of a serial: Wi-Fi for `ip:port` and mDNS TLS serials, else USB.
 *
 * @param serial - The serial.
 * @returns "wifi" or "usb".
 * @example
 * ```ts
 * transportOf("192.168.1.23:37011"); // "wifi"
 * ```
 */
function transportOf(serial: string): WireDevice["transport"] {
  return IP_SERIAL.test(serial) || TLS_SERIAL.test(serial) ? "wifi" : "usb";
}

/**
 * The phones of `adb devices -l`: serial, state (device, unauthorized, offline, other) and
 * transport. The header and the daemon's `*` lines are skipped. A wireless-debugging phone's TLS
 * entry is dropped when the same phone is also listed by its USB serial.
 *
 * @param text - What `adb devices -l` printed.
 * @returns The phones, in adb's order.
 * @example
 * ```ts
 * parseDeviceList("List of devices attached\nR5CX30ABCDE  device usb:1-1 model:SM_A266B\n"); // [{ serial: "R5CX30ABCDE", state: "device", transport: "usb" }]
 * ```
 */
export function parseDeviceList(text: string): ListedDevice[] {
  const listed: ListedDevice[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("*") || trimmed.startsWith("List of devices"))
      continue;

    const [serial = "", state = ""] = trimmed.split(/\s+/);
    listed.push({
      serial,
      state: STATES.find(known => known === state) ?? "other",
      transport: transportOf(serial)
    });
  }

  const serials = new Set(listed.map(device => device.serial));
  return listed.filter(device => {
    const twin = TLS_SERIAL.exec(device.serial)?.[1];
    return twin === undefined || !serials.has(twin);
  });
}

/**
 * The facts of `getprop`: the normalized model, the marketing name (`ro.product.marketname`, else
 * `ro.product.vendor.marketname`) and "Android <release>".
 *
 * @param text - What getprop printed.
 * @returns The facts; null for what it does not say.
 * @example
 * ```ts
 * parseGetprop("[ro.product.model]: [SM-A266B]\n[ro.build.version.release]: [15]\n"); // { model: "SM-A266B", name: null, os: "Android 15" }
 * ```
 */
export function parseGetprop(text: string): DeviceFacts {
  const props = new Map<string, string>();
  for (const line of text.split("\n")) {
    const match = PROP.exec(line.trim());
    if (match?.[1] !== undefined) props.set(match[1], match[2] ?? "");
  }

  const release = cleanText(props.get("ro.build.version.release"));
  return {
    model: normalizeModel(props.get("ro.product.model")),
    name:
      cleanText(props.get("ro.product.marketname")) ??
      cleanText(props.get("ro.product.vendor.marketname")),
    os: release === null ? null : `Android ${release}`
  };
}

/**
 * The devtools socket names of `/proc/net/unix`: `webview_devtools_remote_<pid>` and
 * `chrome_devtools_remote`, each once, nothing else.
 *
 * @param text - What `cat /proc/net/unix` printed.
 * @returns The socket names, without "@".
 * @example
 * ```ts
 * parseUnixSockets("0000: 00000002 00000000 00010000 0001 01 91822 @webview_devtools_remote_23811\n"); // ["webview_devtools_remote_23811"]
 * ```
 */
export function parseUnixSockets(text: string): string[] {
  const names = new Set<string>();
  for (const line of text.split("\n")) {
    const path = line.trim().split(/\s+/).at(-1) ?? "";
    const name = DEVTOOLS.exec(path)?.[1];
    if (name !== undefined) names.add(name);
  }
  return [...names];
}

/**
 * The processes of `ps -A -o PID,NAME`.
 *
 * @param text - What ps printed.
 * @returns pid and name of each, the header skipped.
 * @example
 * ```ts
 * parsePs("  PID NAME\n  612 surfaceflinger\n"); // [{ pid: 612, name: "surfaceflinger" }]
 * ```
 */
export function parsePs(text: string): PsProcess[] {
  const processes: PsProcess[] = [];
  for (const line of text.split("\n")) {
    const match = PS_LINE.exec(line);
    if (match?.[1] !== undefined && match[2] !== undefined) {
      processes.push({ pid: Number(match[1]), name: match[2].trim() });
    }
  }
  return processes;
}

/**
 * Records one line of a section, unless it is a `head:` error line.
 *
 * @param line - The line.
 * @param current - The section's path, undefined outside a known section.
 * @param found - Lines by path, and the paths refused.
 * @param found.lines - Lines by path.
 * @param found.denied - Paths refused.
 */
function takeLine(
  line: string,
  current: string | undefined,
  found: { lines: Map<string, string[]>; denied: Set<string> }
): void {
  const error = HEAD_ERROR.exec(line);
  if (error?.[1] !== undefined) {
    if (error[2]?.includes("Permission denied")) found.denied.add(error[1]);
    return;
  }
  if (current !== undefined) found.lines.get(current)?.push(line);
}

/**
 * The sections of a multi-file `head` by path. A file head could not read has no section (its
 * error went to stderr), so the next file's text is never read as its value. A lone file has no
 * header: the whole text is its section. `head: <path>: Permission denied` lines (an old adb merges
 * stderr) mark the path denied.
 *
 * @param text - What head printed.
 * @param paths - The paths asked, in order.
 * @returns The text of each file read (trailing blank lines dropped) and the paths denied.
 * @example
 * ```ts
 * parseHeadSections("==> /proc/stat <==\ncpu  1 2\n\n==> /sys/kernel/gpu/gpu_clock <==\n221\n", ["/proc/stat", "/sys/kernel/gpu/gpu_clock"]).sections.get("/sys/kernel/gpu/gpu_clock"); // "221"
 * ```
 */
export function parseHeadSections(text: string, paths: readonly string[]): HeadRead {
  const asked = new Set(paths);
  const found = { lines: new Map<string, string[]>(), denied: new Set<string>() };
  let current = paths.length === 1 ? paths[0] : undefined;
  if (current !== undefined) found.lines.set(current, []);

  for (const line of text.split("\n")) {
    const header = SECTION.exec(line)?.[1];
    if (header === undefined) {
      takeLine(line, current, found);
      continue;
    }
    current = asked.has(header) ? header : undefined;
    if (current !== undefined) found.lines.set(current, []);
  }

  const sections = new Map<string, string>();
  for (const [file, lines] of found.lines) {
    const body = lines.join("\n").trimEnd();
    if (body !== "") sections.set(file, body);
  }
  return { sections, denied: found.denied };
}

/**
 * The local port `adb forward tcp:0 …` printed.
 *
 * @param text - What adb printed.
 * @returns The port 1–65535, or undefined.
 * @example
 * ```ts
 * parseForward("40211\n"); // 40211
 * ```
 */
export function parseForward(text: string): number | undefined {
  const line = text.trim();
  if (!PORT.test(line)) return undefined;
  const port = Number(line);
  return port >= 1 && port <= 65_535 ? port : undefined;
}
