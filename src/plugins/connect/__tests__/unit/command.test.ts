import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { AdbCommand } from "../../types";
import { adbArgs } from "../../wire/command";
import { adb } from "../../wire/run";
import { createCtx, SERIAL } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C7: every adb call is built by adbArgs from the AdbCommand union
// (A0–A10) and every interpolated token is validated first.
// Bug: a crafted adb serial or socket name running a shell command on the
// phone, or a second path to adb that skips the allowlist.
// ─────────────────────────────────────────────────────────────────────────────

/** The refusal of a token. */
const REFUSED =
  /^\[moku-editor\] connect: refused adb token ".*"\.\n {2}Serials, pids and paths come from adb itself\.$/;

describe("adbArgs (the allowlist)", () => {
  it("builds the argv of every command A0–A10", () => {
    const built: [AdbCommand, string[]][] = [
      [{ kind: "version" }, ["version"]],
      [{ kind: "devices" }, ["devices", "-l"]],
      [{ kind: "getprop", serial: SERIAL }, ["-s", SERIAL, "shell", "getprop"]],
      [{ kind: "unix-sockets", serial: SERIAL }, ["-s", SERIAL, "shell", "cat", "/proc/net/unix"]],
      [
        { kind: "processes", serial: SERIAL },
        ["-s", SERIAL, "shell", "ps", "-A", "-o", "PID,NAME"]
      ],
      [
        {
          kind: "head",
          serial: "192.168.1.23:37011",
          lines: 1,
          paths: [
            "/proc/stat",
            "/proc/23811/stat",
            "/sys/kernel/gpu/gpu_clock",
            "/sys/class/devfreq/1e00000.mali/cur_freq"
          ]
        },
        [
          "-s",
          "192.168.1.23:37011",
          "shell",
          "head",
          "-n",
          "1",
          "/proc/stat",
          "/proc/23811/stat",
          "/sys/kernel/gpu/gpu_clock",
          "/sys/class/devfreq/1e00000.mali/cur_freq"
        ]
      ],
      [
        { kind: "head", serial: SERIAL, lines: 64, paths: ["/proc/stat"] },
        ["-s", SERIAL, "shell", "head", "-n", "64", "/proc/stat"]
      ],
      [{ kind: "devfreq", serial: SERIAL }, ["-s", SERIAL, "shell", "ls", "/sys/class/devfreq"]],
      [
        { kind: "meminfo", serial: SERIAL, pid: 23_811 },
        ["-s", SERIAL, "shell", "dumpsys", "meminfo", "23811"]
      ],
      [
        { kind: "forward", serial: SERIAL, socket: "webview_devtools_remote_23811" },
        ["-s", SERIAL, "forward", "tcp:0", "localabstract:webview_devtools_remote_23811"]
      ],
      [
        { kind: "forward", serial: SERIAL, socket: "chrome_devtools_remote" },
        ["-s", SERIAL, "forward", "tcp:0", "localabstract:chrome_devtools_remote"]
      ],
      [
        { kind: "forward-remove", serial: SERIAL, port: 40_211 },
        ["-s", SERIAL, "forward", "--remove", "tcp:40211"]
      ]
    ];
    for (const [command, argv] of built) expect(adbArgs(command)).toEqual(argv);
    expect(
      adbArgs({ kind: "getprop", serial: "adb-R5CX30ABCDE-Wq3Kc1._adb-tls-connect._tcp" })[1]
    ).toBe("adb-R5CX30ABCDE-Wq3Kc1._adb-tls-connect._tcp");
  });

  it("refuses every crafted token with the two-line TypeError", () => {
    const tooMany = Array.from({ length: 13 }, (_, index) => `/proc/${index + 1}/stat`);
    const refused: AdbCommand[] = [
      { kind: "getprop", serial: "R5CX; rm -rf /" },
      { kind: "getprop", serial: "R5CX 30" },
      { kind: "processes", serial: "$(reboot)" },
      { kind: "getprop", serial: "" },
      { kind: "meminfo", serial: SERIAL, pid: Number.NaN },
      { kind: "meminfo", serial: SERIAL, pid: 12_345_678 },
      { kind: "meminfo", serial: SERIAL, pid: -1 },
      { kind: "head", serial: SERIAL, lines: 1, paths: ["/data/data/com.moku/secret"] },
      { kind: "head", serial: SERIAL, lines: 1, paths: ["/proc/12ab/stat"] },
      { kind: "head", serial: SERIAL, lines: 1, paths: ["/proc/stat; reboot"] },
      { kind: "head", serial: SERIAL, lines: 1, paths: ["/sys/class/devfreq/a/b/cur_freq"] },
      { kind: "head", serial: SERIAL, lines: 1, paths: tooMany },
      { kind: "head", serial: SERIAL, lines: 1, paths: [] },
      { kind: "head", serial: SERIAL, lines: 2, paths: ["/proc/stat"] },
      { kind: "forward", serial: SERIAL, socket: "foo" },
      { kind: "forward", serial: SERIAL, socket: "webview_devtools_remote_1; ls" },
      { kind: "forward-remove", serial: SERIAL, port: 0 },
      { kind: "forward-remove", serial: SERIAL, port: 65_536 },
      { kind: "forward-remove", serial: SERIAL, port: 1.5 }
    ];
    for (const command of refused) {
      expect(() => adbArgs(command), JSON.stringify(command)).toThrow(TypeError);
      expect(() => adbArgs(command), JSON.stringify(command)).toThrow(REFUSED);
    }
  });

  it("never calls the runner for a refused token, nor removes a forward connect did not make", async () => {
    const ctx = createCtx();
    await expect(adb(ctx, { kind: "getprop", serial: "R5CX; reboot" })).rejects.toThrow(REFUSED);
    await expect(
      adb(ctx, { kind: "forward-remove", serial: SERIAL, port: 40_211 })
    ).rejects.toThrow(REFUSED);
    expect(ctx.run).not.toHaveBeenCalled();

    ctx.state.forwards.set(40_211, SERIAL);
    await adb(ctx, { kind: "forward-remove", serial: SERIAL, port: 40_211 });
    expect(ctx.run.calls()).toEqual([["-s", SERIAL, "forward", "--remove", "tcp:40211"]]);
  });
});

describe("one path to adb", () => {
  it("calls the runner only in wire/run.ts, with the argv of adbArgs", async () => {
    const root = path.join(import.meta.dirname, "../..");
    const entries = await readdir(root, { recursive: true });
    const sources = entries.filter(
      file => file.endsWith(".ts") && !file.includes("__tests__") && !file.startsWith("protocol")
    );
    const callers: string[] = [];
    for (const file of sources) {
      const text = await readFile(path.join(root, file), "utf8");
      if (/\bdeps\.run\(|\brunAdb\(/.test(text)) callers.push(file);
    }
    expect(callers.toSorted()).toEqual(["wire/run.ts"]);

    const run = await readFile(path.join(root, "wire/run.ts"), "utf8");
    expect(run).toMatch(/deps\.run\(ctx\.config\.adb, adbArgs\(command\)/);
  });
});
