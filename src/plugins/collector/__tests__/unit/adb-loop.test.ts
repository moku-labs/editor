/* eslint-disable unicorn/no-null -- null is "not reported" on the thermal line */
import { existsSync } from "node:fs";
import { join } from "node:path/posix";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LinkedDevice } from "../../../hub/types";
import { createAdbLoop, pollRound, reverseRound, startAdbLoop, stopAdbLoop } from "../../adb/loop";
import { stopCollector } from "../../lifecycle";
import { createLogSession } from "../../state";
import type { AdbResult, AdbRunner, LogSession } from "../../types";
import type { TestCtx } from "../helpers";
import { createCtx, deviceOf, fileLines, LOG, removeDir, tempDir } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The adb loop with a fake runner and fake timers: reverse rounds every
// reverseEveryMs, poll rounds every everyS, writes only for a phone matched to
// one live adb log, and nothing after stopAdbLoop.
// ─────────────────────────────────────────────────────────────────────────────

/** What the fake phones answer. */
type Scenario = {
  devices: string[];
  models: Record<string, string>;
  reverseCode: number;
  battery: string;
  thermal: string;
  packages: string;
  gfx: string[];
  missing: boolean;
  /** Shell commands that fail (code 1). */
  failing: string[];
};

/** The computer clock of the poll tests. */
const NOW = 1_791_986_100_000;

/** A page t and the computer time it arrived: offset = t − rx. */
const OFFSET = 5917.4 - 1_791_986_090_000;

/**
 * A gfxinfo text.
 *
 * @param frames - Total frames.
 * @param janky - Janky frames.
 * @param histogram - The histogram part.
 * @returns The text.
 */
function gfxText(frames: number, janky: number, histogram: string): string {
  return `Total frames rendered: ${frames}\nJanky frames: ${janky} (9.6%)\nHISTOGRAM: ${histogram}\n`;
}

/**
 * A scenario of one phone R5 (SM-A266B) running the debug build.
 *
 * @returns The scenario.
 */
function scenarioOf(): Scenario {
  return {
    devices: ["R5"],
    models: { R5: "SM-A266B" },
    reverseCode: 0,
    battery: "  temperature: 351\n",
    thermal:
      "Thermal Status: 1\nCurrent temperatures from HAL:\n\tTemperature{mValue=38.4, mType=3, mName=SKIN, mStatus=1}\n",
    packages: "package:com.example.garden\npackage:com.example.garden.debug\n",
    gfx: [gfxText(1000, 100, "16ms=1000"), gfxText(1412, 196, "16ms=1300 33ms=112")],
    missing: false,
    failing: []
  };
}

/**
 * A successful answer.
 *
 * @param text - Its output.
 * @returns The result.
 */
function ok(text: string): AdbResult {
  return { code: 0, text, missing: false };
}

/**
 * The answer of the fake phones to one command.
 *
 * @param scenario - The scenario.
 * @param args - The adb arguments.
 * @returns The result.
 */
function answer(scenario: Scenario, args: readonly string[]): AdbResult {
  if (scenario.missing) return { code: 127, text: "", missing: true };
  if (args[0] === "devices") {
    const rows = scenario.devices.map(serial => `${serial}\tdevice`);
    return ok(["List of devices attached", ...rows, ""].join("\n"));
  }

  const serial = args[1] ?? "";
  if (args[2] === "reverse") return { code: scenario.reverseCode, text: "", missing: false };

  const command = args.slice(3).join(" ");
  if (scenario.failing.includes(command)) return { code: 1, text: "", missing: false };
  if (command === "getprop ro.product.model") return ok(`${scenario.models[serial] ?? ""}\n`);
  if (command === "dumpsys battery") return ok(scenario.battery);
  if (command === "dumpsys thermalservice") return ok(scenario.thermal);
  if (command.startsWith("pm list packages")) return ok(scenario.packages);
  if (command.startsWith("dumpsys gfxinfo")) return ok(scenario.gfx.shift() ?? "");
  return { code: 1, text: "", missing: false };
}

/**
 * A fake runner over a scenario.
 *
 * @param scenario - The scenario.
 * @returns The runner.
 */
function fakeRunner(scenario: Scenario): Mock<AdbRunner> {
  return vi.fn<AdbRunner>(async (_command, args) => answer(scenario, args));
}

/**
 * The serials of the calls of one adb verb (`reverse`, or a shell command's first word pair).
 *
 * @param run - The runner.
 * @param verb - "reverse", "getprop", "battery", "gfxinfo".
 * @returns The serial of each call.
 */
function serialsOf(run: Mock<AdbRunner>, verb: string): string[] {
  return run.mock.calls
    .filter(([, args]) => args.includes(verb) || args.join(" ").includes(verb))
    .map(([, args]) => args[1] ?? "");
}

/**
 * Lets the fake runner's promise chains settle.
 */
async function settle(): Promise<void> {
  for (let index = 0; index < 50; index += 1) await Promise.resolve();
}

let root: string;
let ctx: TestCtx;

/**
 * A live log of a device in the temp folder.
 *
 * @param device - The device.
 * @param name - The file name.
 * @returns The session, added to the state.
 */
function liveSession(device: LinkedDevice = deviceOf(), name = "a.jsonl"): LogSession {
  const session = createLogSession({ device, log: LOG, file: join(root, name), model: "SM-A266B" });
  session.offset = OFFSET;
  ctx.state.sessions.set(`${device.id}/${name}`, session);
  return session;
}

beforeEach(async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval", "Date"]
  });
  vi.setSystemTime(NOW);
  root = await tempDir();
  ctx = createCtx(root, { appId: "com.example.garden" });
});

afterEach(async () => {
  // Stops the loop and closes the file handles the polls opened (never left to the garbage collector).
  await stopCollector(ctx);
  vi.useRealTimers();
  await removeDir(root);
});

describe("reverse rounds", () => {
  it("reverses every ready phone every round, a phone plugged in later included, and stops with the loop", async () => {
    const scenario = scenarioOf();
    const run = fakeRunner(scenario);

    startAdbLoop(ctx, 47_600, run);
    await settle();
    scenario.devices = ["R5", "Q9"];
    await vi.advanceTimersByTimeAsync(2000);
    await settle();

    expect(serialsOf(run, "reverse")).toEqual(["R5", "R5", "Q9"]);
    expect(run.mock.calls.find(([, args]) => args[2] === "reverse")?.[1]).toEqual([
      "-s",
      "R5",
      "reverse",
      "tcp:47600",
      "tcp:47600"
    ]);
    expect(ctx.log.info).toHaveBeenCalledWith("collector:reversed", {
      serial: "R5",
      model: "SM-A266B",
      port: 47_600
    });

    stopAdbLoop(ctx);
    const calls = run.mock.calls.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run.mock.calls).toHaveLength(calls);
    expect(ctx.state.adb).toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("asks getprop once per appearance of a serial", async () => {
    const scenario = scenarioOf();
    const run = fakeRunner(scenario);
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await reverseRound(ctx, loop, run);
    scenario.devices = [];
    await reverseRound(ctx, loop, run);
    scenario.devices = ["R5"];
    await reverseRound(ctx, loop, run);

    expect(serialsOf(run, "getprop")).toEqual(["R5", "R5"]);
    expect(loop.phones.get("R5")?.model).toBe("SM-A266B");
  });

  it("warns once per serial while reverse fails, and logs reversed again after it succeeds", async () => {
    const scenario = { ...scenarioOf(), reverseCode: 1 };
    const run = fakeRunner(scenario);
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await reverseRound(ctx, loop, run);
    scenario.reverseCode = 0;
    await reverseRound(ctx, loop, run);

    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith(
      "collector:reverse-failed",
      expect.objectContaining({ serial: "R5" })
    );
    expect(loop.phones.get("R5")?.reversed).toBe(true);
  });

  it("skips a tick while a round still runs", async () => {
    const { promise: pending, resolve: release } = Promise.withResolvers<AdbResult>();
    const scenario = scenarioOf();
    const run: Mock<AdbRunner> = vi.fn<AdbRunner>(async (_command, args) =>
      args[0] === "devices" && run.mock.calls.length === 1 ? pending : answer(scenario, args)
    );

    startAdbLoop(ctx, 47_600, run);
    await vi.advanceTimersByTimeAsync(2000);
    expect(run.mock.calls.filter(([, args]) => args[0] === "devices")).toHaveLength(1);

    release(ok("List of devices attached\n"));
    await settle();
    await vi.advanceTimersByTimeAsync(2000);
    expect(run.mock.calls.filter(([, args]) => args[0] === "devices")).toHaveLength(2);
  });

  it("stops both timers and logs once when adb is missing", async () => {
    const run = fakeRunner({ ...scenarioOf(), missing: true });

    const loop = startAdbLoop(ctx, 47_600, run);
    await settle();
    await vi.advanceTimersByTimeAsync(30_000);

    expect(loop.state).toBe("missing");
    expect(ctx.state.adb).toBe(loop);
    expect(vi.getTimerCount()).toBe(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(ctx.log.info).toHaveBeenCalledTimes(1);
    expect(ctx.log.info).toHaveBeenCalledWith("collector:adb-missing", {
      hint: "USB phones need Android platform-tools (adb) on PATH; a LAN phone works without it"
    });
  });
});

describe("poll rounds", () => {
  it("writes a thermal line on the page clock and, from the second reading on, a gfx line, for the phone of one live adb log", async () => {
    const session = liveSession();
    const run = fakeRunner(scenarioOf());
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    await session.queue;
    const first = await fileLines(session.file);
    vi.setSystemTime(NOW + 10_000);
    await pollRound(ctx, loop, run);
    await session.queue;
    const lines = await fileLines(session.file);

    expect(first.map(line => line.kind)).toEqual(["thermal"]);
    expect(lines.map(line => line.kind)).toEqual(["thermal", "thermal", "gfx"]);
    expect(lines[0]).toEqual({
      v: 1,
      kind: "thermal",
      t: 15_917.4,
      build: "debug-pair",
      rx: NOW,
      source: "collector",
      device: "SM-A266B",
      status: 1,
      headroom: null,
      at: 15_917.4,
      android: { status: 1, headroom: null, forecastSeconds: null },
      batteryC: 35.1,
      sensors: { SKIN: 38.4 }
    });
    expect(lines[2]).toMatchObject({
      kind: "gfx",
      t: 25_917.4,
      rx: NOW + 10_000,
      device: "SM-A266B",
      seconds: 10,
      frames: 412,
      janky: 96,
      fps: 41.2,
      p50: 16,
      p90: 33,
      p99: 33,
      hist: { "16": 300, "33": 112 }
    });
    expect(run.mock.calls.some(([, args]) => args.includes("com.example.garden.debug"))).toBe(true);
    expect(session.digest).toBeNull();
    expect(session.facts.thermal).toEqual({ status: 1, batteryC: 35.1 });
  });

  it("writes nothing for two live logs of the same model and logs adb-ambiguous once", async () => {
    const one = liveSession(deviceOf({ id: "d-0001" }), "one.jsonl");
    const two = liveSession(deviceOf({ id: "d-0002" }), "two.jsonl");
    const run = fakeRunner(scenarioOf());
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    await Promise.all([one.queue, two.queue]);

    expect(existsSync(one.file) || existsSync(two.file)).toBe(false);
    expect(ctx.log.info).toHaveBeenCalledWith("collector:adb-ambiguous", { model: "SM-A266B" });
    expect(
      ctx.log.info.mock.calls.filter(([event]) => event === "collector:adb-ambiguous")
    ).toHaveLength(1);
  });

  it("matches the phone to the configured app's log when another app's log of the same model is live", async () => {
    // Bug: a second game's log of the same model making the phone ambiguous: no heat, no gfx.
    const garden = liveSession(
      deviceOf({ id: "d-0001", appId: "com.example.garden.debug" }),
      "garden.jsonl"
    );
    const other = liveSession(deviceOf({ id: "d-0002", appId: "com.other.game" }), "other.jsonl");
    const run = fakeRunner(scenarioOf());
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    await Promise.all([garden.queue, other.queue]);

    const lines = await fileLines(garden.file);
    expect(lines.map(line => line.kind)).toEqual(["thermal"]);
    expect(existsSync(other.file)).toBe(false);
    expect(ctx.log.info).not.toHaveBeenCalledWith("collector:adb-ambiguous", expect.anything());
  });

  it("never writes adb lines into a LAN log", async () => {
    const session = liveSession(deviceOf({ link: "lan", address: "phone.lan" }));
    const run = fakeRunner(scenarioOf());
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    await session.queue;

    expect(existsSync(session.file)).toBe(false);
    expect(serialsOf(run, "battery")).toEqual([]);
  });

  it("writes nothing when stopAdbLoop runs in the middle of a round", async () => {
    const session = liveSession();
    const { promise: pending, resolve: release } = Promise.withResolvers<AdbResult>();
    const scenario = scenarioOf();
    const run: Mock<AdbRunner> = vi.fn<AdbRunner>(async (_command, args) =>
      args.includes("battery") ? pending : answer(scenario, args)
    );
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;
    await reverseRound(ctx, loop, run);

    const round = pollRound(ctx, loop, run);
    await settle();
    stopAdbLoop(ctx);
    release(ok("  temperature: 351\n"));
    await round;
    await session.queue;

    expect(existsSync(session.file)).toBe(false);
  });

  it("writes the battery reading when the thermal service fails, and no thermal line when both fail", async () => {
    const session = liveSession();
    const scenario = { ...scenarioOf(), failing: ["dumpsys thermalservice"] };
    const run = fakeRunner(scenario);
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    scenario.failing = ["dumpsys thermalservice", "dumpsys battery"];
    await pollRound(ctx, loop, run);
    await session.queue;

    const lines = await fileLines(session.file);
    expect(lines.filter(line => line.kind === "thermal")).toEqual([
      expect.objectContaining({ status: null, batteryC: 35.1, sensors: null })
    ]);
  });

  it("skips a poll tick while a poll still runs (bug: two heat lines of one reading)", async () => {
    const session = liveSession();
    const { promise: pending, resolve: release } = Promise.withResolvers<AdbResult>();
    const scenario = scenarioOf();
    const run: Mock<AdbRunner> = vi.fn<AdbRunner>(async (_command, args) =>
      args.includes("battery") ? pending : answer(scenario, args)
    );
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;
    await reverseRound(ctx, loop, run);

    const first = pollRound(ctx, loop, run);
    await pollRound(ctx, loop, run);
    release(ok("  temperature: 351\n"));
    await first;
    await session.queue;

    expect(serialsOf(run, "battery")).toEqual(["R5"]);
    const written = await fileLines(session.file);
    expect(written.filter(line => line.kind === "thermal")).toHaveLength(1);
  });

  it("starts a new gfx baseline after a reading of an app that does not run", async () => {
    const session = liveSession();
    const scenario = scenarioOf();
    scenario.gfx = [
      gfxText(1000, 100, "16ms=1000"),
      "No process found for: com.example.garden.debug\n",
      gfxText(1412, 196, "16ms=1300 33ms=112")
    ];
    const run = fakeRunner(scenario);
    const loop = createAdbLoop(ctx, 47_600, run);
    ctx.state.adb = loop;

    await reverseRound(ctx, loop, run);
    for (const step of [0, 10_000, 20_000]) {
      vi.setSystemTime(NOW + step);
      await pollRound(ctx, loop, run);
    }
    await session.queue;

    const written = await fileLines(session.file);
    expect(written.map(line => line.kind)).toEqual(["thermal", "thermal", "thermal"]);
    expect(loop.phones.get("R5")?.gfx?.at).toBe(NOW + 20_000);
  });
});
