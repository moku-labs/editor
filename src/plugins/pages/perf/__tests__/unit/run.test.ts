/* eslint-disable unicorn/no-null -- null is "not known" on the digest, the device and the pairing request */
/* eslint-disable sonarjs/no-hardcoded-ip -- the LAN address of the fixture phone */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../../../../server";
import type { CollectorSessionInfo } from "../../../../collector/types";
import type { DeviceListenOptions } from "../../../../hub/types";
import { perfDiscoveryPath, readPerfDiscovery } from "../../discovery";
import { runPerf } from "../../run";
import type { PerfArgs, PerfDeps } from "../../types";
import {
  perfDeps,
  perfLogText,
  recordingConsole,
  removeRoot,
  sessionEvent,
  tempRoot
} from "../helpers";

// The server core is a stub that records its calls: the order of the stop matters here.
vi.mock("../../../../../server", () => ({ createApp: vi.fn() }));

/** `moku-editor perf` with the defaults. */
const ARGS: PerfArgs = {
  kind: "perf",
  lan: false,
  port: 47_600,
  out: ".moku/perf",
  every: 10,
  ui: true
};

/** The hub token of the stub. */
const TOKEN = "s".repeat(43);

let root: string;

beforeEach(async () => {
  root = await tempRoot();
});

afterEach(async () => {
  vi.mocked(createApp).mockReset();
  await removeRoot(root);
});

/**
 * A log of this run as the collector reports it.
 *
 * @param name - The file name under `.moku/perf`.
 * @param lines - Its line count.
 * @param lost - Lines lost on the phone.
 * @returns The info.
 */
function logInfo(name: string, lines: number, lost = 0): CollectorSessionInfo {
  const { device } = sessionEvent();
  const file = join(root, ".moku/perf", name);
  return { device, log: name, file, state: "done", lines, lost, last: null, stopTimedOut: false };
}

/**
 * A stub editor that records the order of start, stopDevices (with whether perf.json is still
 * there), stop and sessions.
 *
 * @param sessions - What collector.sessions() answers.
 * @returns The stub and its order.
 */
function stubEditor(sessions: CollectorSessionInfo[] = []) {
  const order: string[] = [];
  const editor = {
    log: { clearSinks: vi.fn(), addSink: vi.fn() },
    start: vi.fn(async () => {
      order.push("start");
    }),
    stop: vi.fn(async () => {
      order.push("stop");
    }),
    hub: {
      listenDevices: vi.fn(async (_options: DeviceListenOptions) => ({
        port: 47_600,
        adb: "127.0.0.1:47600",
        lan: null
      })),
      stopDevices: vi.fn(async () => {
        order.push(
          `stopDevices, perf.json ${existsSync(perfDiscoveryPath(root)) ? "kept" : "gone"}`
        );
      }),
      path: () => "/__editor",
      token: () => TOKEN
    },
    pages: { attachPerf: vi.fn() },
    collector: {
      sessions: vi.fn(() => {
        order.push("sessions");
        return sessions;
      }),
      settled: vi.fn(async () => {
        await Promise.resolve();
        order.push("settled");
      })
    },
    files: { engine: () => ({ id: "0.14.12+9c41e0", version: "0.14.12", dist: "9c41e0" }) }
  };
  vi.mocked(createApp).mockReturnValue(editor as unknown as ReturnType<typeof createApp>);
  return { editor, order };
}

/**
 * Deps of a run in the temp root, reading real files.
 *
 * @param overrides - Members to replace.
 * @returns The deps.
 */
function depsIn(overrides: Partial<PerfDeps> = {}): PerfDeps {
  return perfDeps({ cwd: () => root, readText: path => readFile(path, "utf8"), ...overrides });
}

describe("runPerf start", () => {
  it("starts the core with the switches and extra config merged, the terminal prompt, the no-game page and the live lines", async () => {
    const { editor } = stubEditor();
    const ask = vi.fn<PerfDeps["ask"]>(() => Promise.resolve("4821"));
    const deps = depsIn({
      ask,
      appIdOf: () => Promise.resolve("com.example.garden"),
      extraConfig: { collector: { adb: "/no/adb" } }
    });
    const { ui } = recordingConsole();

    const started = await runPerf(ARGS, deps, ui);

    expect(started.code).toBe(0);
    expect(createApp).toHaveBeenCalledWith({
      pluginConfigs: {
        files: { root, project: false },
        hub: { devicePort: 47_600, deviceLan: false },
        collector: { out: ".moku/perf", everyS: 10, appId: "com.example.garden", adb: "/no/adb" },
        pages: { toolsPage: true }
      }
    });
    expect(editor.log.clearSinks).toHaveBeenCalled();
    expect(editor.log.addSink).toHaveBeenCalledTimes(1);
    expect(editor.pages.attachPerf).toHaveBeenCalledWith(ui);

    const options = editor.hub.listenDevices.mock.calls[0]?.[0];
    const home = options?.routes?.["/"];
    expect(home).toBeInstanceOf(Response);
    const request = { code: "4821", model: "SM-A266B", address: "192.168.1.23", link: "lan" };
    const linked = await options?.confirm(
      { ...request, link: "lan", engine: null, build: null },
      new AbortController().signal
    );
    expect(linked).toBe(true);
    expect(ask).toHaveBeenCalledTimes(1);

    expect(readPerfDiscovery(root)).toMatchObject({ pid: 4242, port: 47_600, token: TOKEN });
    await started.stop?.();
  });

  it("prints a start failure and answers 1 without listening", async () => {
    const { editor } = stubEditor();
    editor.start.mockRejectedValueOnce(new Error("[moku-editor] boom.\n  Fix it."));
    const { ui, lines } = recordingConsole();
    await expect(runPerf(ARGS, depsIn(), ui)).resolves.toEqual({ code: 1 });
    expect(lines).toEqual(["  ✗ [moku-editor] boom.\n  Fix it."]);
    expect(editor.hub.listenDevices).not.toHaveBeenCalled();

    vi.mocked(createApp).mockImplementationOnce(() => {
      throw new TypeError("[moku-editor] pages.toolsPage is no.\n  Give true or false.");
    });
    await expect(runPerf(ARGS, depsIn(), ui)).resolves.toEqual({ code: 1 });
  });

  it("prints the hub's in-use message, stops the editor and answers 1 when the port is taken", async () => {
    const { editor } = stubEditor();
    const message =
      "[moku-editor] port 47600 is in use.\n  Is another moku-editor perf running? Try --port 47601.";
    editor.hub.listenDevices.mockRejectedValueOnce(
      Object.assign(new Error(message), { code: "EADDRINUSE" })
    );
    const { ui, lines } = recordingConsole();
    await expect(runPerf(ARGS, depsIn(), ui)).resolves.toEqual({ code: 1 });
    expect(lines).toEqual([`  ✗ ${message}`]);
    expect(editor.stop).toHaveBeenCalledTimes(1);
    expect(existsSync(perfDiscoveryPath(root))).toBe(false);
  });
});

describe("runPerf stop", () => {
  it("removes perf.json, stops device mode, waits for the collector to settle, then stops the editor and reads the logs (bug: done lines cut by the stop)", async () => {
    const { order } = stubEditor();
    const started = await runPerf(ARGS, depsIn(), recordingConsole().ui);
    await started.stop?.();
    expect(order).toEqual(["start", "stopDevices, perf.json gone", "settled", "stop", "sessions"]);
  });

  it("runs once when called twice", async () => {
    const { editor } = stubEditor();
    const started = await runPerf(ARGS, depsIn(), recordingConsole().ui);
    await Promise.all([started.stop?.(), started.stop?.()]);
    expect(editor.hub.stopDevices).toHaveBeenCalledTimes(1);
    expect(editor.stop).toHaveBeenCalledTimes(1);
  });

  it("prints the summary of each log with lines, and one warning for a log it cannot read", async () => {
    stubEditor([logInfo("a.jsonl", 1840, 12), logInfo("empty.jsonl", 0), logInfo("b.jsonl", 3)]);
    await mkdir(join(root, ".moku/perf"), { recursive: true });
    await writeFile(join(root, ".moku/perf/a.jsonl"), perfLogText());
    const { ui, lines } = recordingConsole();
    const started = await runPerf(ARGS, depsIn(), ui);
    const before = lines.length;
    await started.stop?.();

    const summary = lines.slice(before);
    expect(summary.slice(0, 3)).toEqual([
      "",
      "  › log .moku/perf/a.jsonl · 1 840 lines · 12 lost",
      expect.stringMatching(/^SM-A266B · webgpu · engine 0\.14\.12\+9c41e0/)
    ]);
    expect(summary.some(line => line.includes("empty.jsonl"))).toBe(false);
    expect(summary.at(-1)).toMatch(/^ {2}⚠ could not read \.moku\/perf\/b\.jsonl: /);
  });
});

describe("runPerf stop hardening (I6)", () => {
  it("still stops the editor when stopDevices rejects", async () => {
    const { editor } = stubEditor();
    const started = await runPerf(ARGS, depsIn(), recordingConsole().ui);
    editor.hub.stopDevices.mockRejectedValueOnce(new Error("listener stuck"));
    await expect(started.stop?.()).rejects.toThrow("listener stuck");
    expect(editor.stop).toHaveBeenCalledTimes(1);
  });
});
