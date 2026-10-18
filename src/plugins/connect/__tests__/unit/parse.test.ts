/* eslint-disable unicorn/no-null -- null is "not reported" in the parsers' answers */
import { describe, expect, it } from "vitest";
import {
  parseDeviceList,
  parseForward,
  parseGetprop,
  parseHeadSections,
  parsePs,
  parseUnixSockets
} from "../../wire/parse";
import { fixture } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C4, C5, C6: the pure parsers of adb's answers, on fixture output.
// ─────────────────────────────────────────────────────────────────────────────

describe("parseDeviceList", () => {
  it("reads ready, unauthorized and offline phones with their transport, the TLS twin dropped", () => {
    // Bug: one phone listed twice (USB and its wireless-debugging twin).
    expect(parseDeviceList(fixture("devices-l.txt"))).toEqual([
      { serial: "R5CX30ABCDE", state: "device", transport: "usb" },
      { serial: "RZ8T20QWERT", state: "unauthorized", transport: "usb" },
      { serial: "192.168.1.23:37011", state: "device", transport: "wifi" },
      { serial: "emulator-5554", state: "offline", transport: "usb" }
    ]);
  });

  it("keeps a TLS serial without a USB twin as wifi, skips daemon lines, and maps other states", () => {
    const text = [
      "* daemon not running; starting now at tcp:5037",
      "* daemon started successfully",
      "List of devices attached",
      "adb-RZ8T20QWERT-a1B2c3._adb-tls-connect._tcp device product:x model:SM_A256B",
      "0123456789ABCDEF       no permissions (user in plugdev group); see [http://developer.android.com/tools/device.html]",
      ""
    ].join("\n");
    expect(parseDeviceList(text)).toEqual([
      {
        serial: "adb-RZ8T20QWERT-a1B2c3._adb-tls-connect._tcp",
        state: "device",
        transport: "wifi"
      },
      { serial: "0123456789ABCDEF", state: "other", transport: "usb" }
    ]);
  });
});

describe("parseGetprop", () => {
  it("reads the model, the vendor marketing name and the Android version", () => {
    expect(parseGetprop(fixture("getprop-a26.txt"))).toEqual({
      model: "SM-A266B",
      name: "Galaxy A26",
      os: "Android 15"
    });
  });

  it("prefers ro.product.marketname, normalizes the model and gives null for what is absent", () => {
    const text = "[ro.product.model]: [sm a266b ]\n[ro.product.marketname]: [Galaxy A26 5G‮]\n";
    expect(parseGetprop(text)).toEqual({ model: "SM-A266B", name: "Galaxy A26 5G", os: null });
    expect(parseGetprop("")).toEqual({ model: null, name: null, os: null });
  });
});

describe("parseUnixSockets", () => {
  it("finds the WebView and Chrome devtools sockets and nothing else", () => {
    expect(parseUnixSockets(fixture("proc-net-unix-socket.txt"))).toEqual([
      "webview_devtools_remote_23811",
      "chrome_devtools_remote"
    ]);
    expect(parseUnixSockets(fixture("proc-net-unix.txt"))).toEqual([]);
  });
});

describe("parsePs", () => {
  it("reads pid and name of every process, the header skipped", () => {
    const processes = parsePs(fixture("ps-a26.txt"));
    expect(processes[0]).toEqual({ pid: 1, name: "init" });
    expect(processes).toContainEqual({ pid: 612, name: "surfaceflinger" });
    expect(processes).toContainEqual({ pid: 23_811, name: "com.moku.garden.debug" });
    expect(processes.some(process => process.name === "NAME")).toBe(false);
  });
});

describe("parseHeadSections", () => {
  it("splits the sections by path; a file head could not read has no section", () => {
    // Bug: the next file's text read as the GPU clock.
    const paths = ["/proc/stat", "/sys/kernel/gpu/gpu_busy", "/sys/kernel/gpu/gpu_clock"];
    const text = "==> /proc/stat <==\ncpu  1 2 3 4\n\n==> /sys/kernel/gpu/gpu_clock <==\n221\n";
    const read = parseHeadSections(text, paths);
    expect([...read.sections]).toEqual([
      ["/proc/stat", "cpu  1 2 3 4"],
      ["/sys/kernel/gpu/gpu_clock", "221"]
    ]);
    expect(read.sections.has("/sys/kernel/gpu/gpu_busy")).toBe(false);
  });

  it("reads a lone file without a header, and a denial merged into stdout", () => {
    expect([...parseHeadSections("cpu  1 2\ncpu0 1 1\n", ["/proc/stat"]).sections]).toEqual([
      ["/proc/stat", "cpu  1 2\ncpu0 1 1"]
    ]);
    const merged =
      "==> /proc/stat <==\ncpu  1 2\nhead: /sys/kernel/gpu/gpu_busy: Permission denied\n\n==> /proc/612/stat <==\n612 (sf) S\n";
    const read = parseHeadSections(merged, [
      "/proc/stat",
      "/sys/kernel/gpu/gpu_busy",
      "/proc/612/stat"
    ]);
    expect(read.sections.get("/proc/stat")).toBe("cpu  1 2");
    expect([...read.denied]).toEqual(["/sys/kernel/gpu/gpu_busy"]);
  });
});

describe("parseForward", () => {
  it("reads the local port adb printed", () => {
    expect(parseForward("40211\n")).toBe(40_211);
    expect(parseForward("error: device offline\n")).toBeUndefined();
    expect(parseForward("70000\n")).toBeUndefined();
  });
});
