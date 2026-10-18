/**
 * @file connect plugin — the adb allowlist (spec 11 C7, A0–A10): `adbArgs` builds the argv of an
 * AdbCommand and nothing else, and validates every interpolated token first. A serial, a pid, a
 * path, a socket name or a port that does not look like what adb itself prints is refused with a
 * two-line TypeError before anything runs, so a serial like `R5CX; rm -rf /` never reaches a shell
 * on the phone. `reverse` is not here: it stays the collector's.
 */
import { GPU_NODES } from "../telemetry/gpu";
import type { AdbCommand } from "../types";

/** A serial as adb prints it: USB, `ip:port`, or an `_adb-tls-connect` mDNS name. */
const SERIAL = /^[\w.:-]{1,96}$/;

/** A pid. */
const PID = /^\d{1,7}$/;

/** A process's stat file. */
const PROC_STAT = /^\/proc\/\d{1,7}\/stat$/;

/** A devfreq clock file. */
const DEVFREQ = /^\/sys\/class\/devfreq\/[\w.-]{1,64}\/cur_freq$/;

/** The devtools socket of a WebView or of Chrome. */
const DEVTOOLS_SOCKET = /^(?:webview_devtools_remote_\d{1,7}|chrome_devtools_remote)$/;

/** The line counts `head -n` may take. */
const HEAD_LINES: ReadonlySet<number> = new Set([1, 64]);

/** The most files one `head` call reads. */
export const MAX_HEAD_PATHS = 12;

/** The highest TCP port. */
const MAX_PORT = 65_535;

/** The GPU node files the table lists. */
const GPU_PATHS: ReadonlySet<string> = new Set(GPU_NODES.map(node => node.path));

/**
 * The refusal of a token.
 *
 * @param token - The token as given.
 * @returns The two-line TypeError.
 * @example
 * ```ts
 * refused("R5CX; reboot").message; // '[moku-editor] connect: refused adb token "R5CX; reboot".\n  Serials, pids and paths come from adb itself.'
 * ```
 */
export function refused(token: string): TypeError {
  return new TypeError(
    `[moku-editor] connect: refused adb token "${token}".\n  Serials, pids and paths come from adb itself.`
  );
}

/**
 * A serial, checked.
 *
 * @param serial - The serial.
 * @returns It.
 * @throws {TypeError} When it does not look like an adb serial.
 * @example
 * ```ts
 * serialOf("192.168.1.23:37011"); // "192.168.1.23:37011"
 * ```
 */
function serialOf(serial: string): string {
  if (!SERIAL.test(serial)) throw refused(serial);
  return serial;
}

/**
 * A pid, checked, as text.
 *
 * @param pid - The pid.
 * @returns Its digits.
 * @throws {TypeError} When it is not a whole number of at most 7 digits.
 * @example
 * ```ts
 * pidOf(23811); // "23811"
 * ```
 */
function pidOf(pid: number): string {
  const text = String(pid);
  if (!PID.test(text)) throw refused(text);
  return text;
}

/**
 * Whether a path is one `head` may read: /proc/stat, a process's stat, a GPU node of the table or a
 * devfreq clock.
 *
 * @param file - The path.
 * @returns True when it may be read.
 * @example
 * ```ts
 * isReadable("/sys/class/devfreq/1e00000.mali/cur_freq"); // true
 * ```
 */
function isReadable(file: string): boolean {
  return file === "/proc/stat" || PROC_STAT.test(file) || GPU_PATHS.has(file) || DEVFREQ.test(file);
}

/**
 * The argv of `head -n <lines> <paths…>` on a phone, checked.
 *
 * @param command - The head command.
 * @returns The argv.
 * @throws {TypeError} For another line count, no path, more than 12 paths or a path off the list.
 * @example
 * ```ts
 * headArgs({ kind: "head", serial: "R5CX30ABCDE", lines: 1, paths: ["/proc/stat"] }); // ["-s", "R5CX30ABCDE", "shell", "head", "-n", "1", "/proc/stat"]
 * ```
 */
function headArgs(command: Extract<AdbCommand, { kind: "head" }>): string[] {
  const serial = serialOf(command.serial);
  if (!HEAD_LINES.has(command.lines)) throw refused(String(command.lines));
  const { paths } = command;
  if (paths.length === 0 || paths.length > MAX_HEAD_PATHS) throw refused(`${paths.length} paths`);
  for (const file of paths) if (!isReadable(file)) throw refused(file);
  return ["-s", serial, "shell", "head", "-n", String(command.lines), ...paths];
}

/**
 * The argv of a forward removal, checked.
 *
 * @param serial - The serial.
 * @param port - The local port.
 * @returns The argv.
 * @throws {TypeError} For a port that is not a whole number 1–65535.
 * @example
 * ```ts
 * removeArgs("R5CX30ABCDE", 40211); // ["-s", "R5CX30ABCDE", "forward", "--remove", "tcp:40211"]
 * ```
 */
function removeArgs(serial: string, port: number): string[] {
  if (!Number.isInteger(port) || port < 1 || port > MAX_PORT) throw refused(String(port));
  return ["-s", serialOf(serial), "forward", "--remove", `tcp:${port}`];
}

/**
 * The argv of one allowlisted adb command (A0–A10). Every token is checked before the argv is
 * built; the runner takes only this output.
 *
 * @param command - The command.
 * @returns The argv for the adb command.
 * @throws {TypeError} `[moku-editor] connect: refused adb token "<t>".` for a token that does not
 * look like what adb prints.
 * @example
 * ```ts
 * adbArgs({ kind: "meminfo", serial: "R5CX30ABCDE", pid: 23811 }); // ["-s", "R5CX30ABCDE", "shell", "dumpsys", "meminfo", "23811"]
 * ```
 */
export function adbArgs(command: AdbCommand): string[] {
  switch (command.kind) {
    case "version": {
      return ["version"];
    }
    case "devices": {
      return ["devices", "-l"];
    }
    case "getprop": {
      return ["-s", serialOf(command.serial), "shell", "getprop"];
    }
    case "unix-sockets": {
      return ["-s", serialOf(command.serial), "shell", "cat", "/proc/net/unix"];
    }
    case "processes": {
      return ["-s", serialOf(command.serial), "shell", "ps", "-A", "-o", "PID,NAME"];
    }
    case "head": {
      return headArgs(command);
    }
    case "devfreq": {
      return ["-s", serialOf(command.serial), "shell", "ls", "/sys/class/devfreq"];
    }
    case "meminfo": {
      const serial = serialOf(command.serial);
      return ["-s", serial, "shell", "dumpsys", "meminfo", pidOf(command.pid)];
    }
    case "forward": {
      const serial = serialOf(command.serial);
      if (!DEVTOOLS_SOCKET.test(command.socket)) throw refused(command.socket);
      return ["-s", serial, "forward", "tcp:0", `localabstract:${command.socket}`];
    }
    case "forward-remove": {
      return removeArgs(command.serial, command.port);
    }
  }
}
