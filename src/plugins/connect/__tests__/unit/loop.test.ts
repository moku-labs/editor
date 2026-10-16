import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { turnWireOn } from "../../mode";
import { watchDevice } from "../../telemetry/loop";
import type { AdbResult, DeviceTelemetry } from "../../types";
import { scanOnce } from "../../wire/scan";
import type { FakeRunner, TestCtx } from "../helpers";
import {
  a26,
  a26Device,
  createCtx,
  deviceSession,
  fakeCdp,
  fakeRunner,
  fixture,
  ok,
  PIDS,
  publishedOf,
  SERIAL
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// spec 11 C6: the telemetry loop of a watched, wired, linked A26 under fake
// timers — the probe, the 1 Hz tick, meminfo every 5 s, the CDP heap at 4 Hz,
// the lease, the re-probe, publish + emit, one reading degrading alone.
// ─────────────────────────────────────────────────────────────────────────────

/** The heap of the fake WebView: a sawtooth 27 → 57 → 31 MB (bytes). */
const SAWTOOTH = [27, 39, 48, 57, 31, 35].map(mb => mb * 1_048_576);

/**
 * Whether an argv is the telemetry tick's `head -n 1` (it reads /proc/stat).
 *
 * @param args - The argv.
 * @returns True for a tick.
 */
function isTick(args: readonly string[]): boolean {
  return args[3] === "head" && args[5] === "1" && args.includes("/proc/stat");
}

/**
 * The A26 whose ticks alternate the two tick fixtures; `change` may answer a call first.
 *
 * @param change - argv → a different answer, or undefined for the A26's.
 * @returns The runner.
 */
function tickRunner(
  change?: (args: readonly string[]) => AdbResult | Promise<AdbResult> | undefined
): FakeRunner {
  let ticks = 0;
  return fakeRunner(args => {
    const changed = change?.(args);
    if (changed !== undefined) return changed;
    if (!isTick(args)) return a26(args);
    ticks += 1;
    return ok(fixture(ticks % 2 === 1 ? "head-tick-1.txt" : "head-tick-2.txt"));
  });
}

/**
 * The argv of the calls that match.
 *
 * @param ctx - The ctx.
 * @param match - The matcher.
 * @returns How many calls matched.
 */
function count(ctx: TestCtx, match: (args: readonly string[]) => boolean): number {
  return ctx.run.calls().filter(args => match(args)).length;
}

/**
 * A ctx in device mode by wire with the A26 linked and scanned, its watch granted, the probe done.
 *
 * @param run - The adb runner.
 * @returns The ctx.
 */
async function watched(run: FakeRunner = tickRunner()): Promise<TestCtx> {
  let sample = 0;
  const cdp = fakeCdp(() => {
    const used = SAWTOOTH[sample % SAWTOOTH.length] ?? 0;
    sample += 1;
    return { usedSize: used, totalSize: 64 * 1_048_576 };
  });
  const ctx = createCtx({ run, cdp });
  await turnWireOn(ctx);
  const device = a26Device();
  ctx.hub.linked.push(device);
  ctx.hub.open.push(deviceSession(device));
  await scanOnce(ctx);
  expect(watchDevice(ctx, "d-7f3a", 1)).toEqual({ wired: true });
  await vi.advanceTimersByTimeAsync(0);
  return ctx;
}

/**
 * The telemetry records the hub published.
 *
 * @param ctx - The ctx.
 * @returns The records, oldest first.
 */
function records(ctx: TestCtx): DeviceTelemetry[] {
  return publishedOf(ctx.hub, "deviceTelemetry");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("the telemetry loop", () => {
  it("publishes and emits one record per tick, every reading naming its source", async () => {
    const ctx = await watched();
    await vi.advanceTimersByTimeAsync(2000);

    const [first, second] = records(ctx);
    expect(first?.cpu.app).toEqual({
      available: false,
      source: "/proc/23811/stat",
      reason: "warming-up"
    });
    expect(first?.memory.app).toEqual({
      available: false,
      source: "dumpsys meminfo",
      reason: "warming-up"
    });
    expect(second).toMatchObject({
      v: 1,
      device: "d-7f3a",
      serial: SERIAL,
      wired: true,
      gpu: {
        available: true,
        source: "/sys/kernel/gpu",
        value: { mhz: 949, busyPct: 88, minMhz: 221, maxMhz: 949 }
      },
      cpu: {
        cores: 8,
        app: {
          available: true,
          source: "/proc/23811/stat",
          value: { pid: PIDS.app, name: "com.moku.garden.debug", pct: 14.3, oneCorePct: 114 }
        },
        renderer: {
          available: true,
          source: "/proc/23870/stat",
          value: { pid: PIDS.renderer, pct: 5, oneCorePct: 40 }
        },
        surfaceflinger: {
          available: true,
          source: "/proc/612/stat",
          value: { pid: PIDS.surfaceflinger, name: "surfaceflinger", pct: 2.1, oneCorePct: 17 }
        }
      },
      memory: {
        app: {
          available: true,
          source: "dumpsys meminfo",
          value: { pid: PIDS.app, totalPssMb: 541 }
        },
        renderer: {
          available: true,
          source: "dumpsys meminfo",
          value: { pid: PIDS.renderer, totalPssMb: 424 }
        }
      },
      heap: { available: true, source: "cdp Runtime.getHeapUsage" }
    });
    expect(ctx.emit).toHaveBeenCalledWith("connect:telemetry", second);
    expect(ctx.emit).toHaveBeenCalledTimes(records(ctx).length);
    expect(Object.isFrozen(second)).toBe(true);
  });

  it("carries the CDP heap samples of the tick and the GCs inferred from them", async () => {
    const ctx = await watched();
    await vi.advanceTimersByTimeAsync(3000);
    const heaps = records(ctx).map(record =>
      record.heap.available ? record.heap.value : undefined
    );
    const samples = heaps.flatMap(heap => heap?.samples ?? []).map(sample => sample.usedMb);
    expect(samples.slice(0, 6)).toEqual([27, 39, 48, 57, 31, 35]);
    expect(heaps.flatMap(heap => heap?.gcs ?? [])[0]).toMatchObject({
      freedMb: 26,
      inferred: true
    });
  });

  it("runs exactly one head call per tick, and dumpsys meminfo every 5 s", async () => {
    const ctx = await watched();
    await vi.advanceTimersByTimeAsync(2500);
    const before = count(ctx, isTick);
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(ctx, isTick) - before).toBe(1);

    await vi.advanceTimersByTimeAsync(6000);
    const meminfo = ctx.run.calls().filter(args => args[3] === "dumpsys");
    expect(meminfo).toEqual([
      ["-s", SERIAL, "shell", "dumpsys", "meminfo", "23811"],
      ["-s", SERIAL, "shell", "dumpsys", "meminfo", "23870"],
      ["-s", SERIAL, "shell", "dumpsys", "meminfo", "23811"],
      ["-s", SERIAL, "shell", "dumpsys", "meminfo", "23870"]
    ]);
  });

  it("skips the ticks of a slow phone instead of queuing them", async () => {
    // Bug: adb calls piling up and loading the phone they measure.
    let release: (() => void) | undefined;
    let slow = false;
    const run = tickRunner(args => {
      if (!slow || !isTick(args)) return undefined;
      return new Promise<AdbResult>(resolve => {
        release = () => resolve(ok(fixture("head-tick-1.txt")));
      });
    });
    const ctx = await watched(run);
    await vi.advanceTimersByTimeAsync(1500);
    slow = true;
    const before = count(ctx, isTick);

    await vi.advanceTimersByTimeAsync(4000);
    expect(count(ctx, isTick) - before).toBe(1);

    slow = false;
    release?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(count(ctx, isTick) - before).toBe(2);
  });

  it("ends the attach when the lease is not renewed for leaseMs, and keeps it while renewed", async () => {
    const ctx = await watched();
    await vi.advanceTimersByTimeAsync(8000);
    expect(watchDevice(ctx, "d-7f3a", 1)).toEqual({ wired: true });
    await vi.advanceTimersByTimeAsync(4000);
    expect(ctx.state.attaches.has("d-7f3a")).toBe(true);

    await vi.advanceTimersByTimeAsync(6000);
    expect(ctx.state.attaches.size).toBe(0);
    expect(ctx.cdp.sockets[0]?.closed).toBe(true);
    expect(ctx.run.calls()).toContainEqual(["-s", SERIAL, "forward", "--remove", "tcp:40211"]);
    expect(ctx.state.forwards.size).toBe(0);
    const ticks = count(ctx, isTick);
    await vi.advanceTimersByTimeAsync(3000);
    expect(count(ctx, isTick)).toBe(ticks);
  });

  it("re-probes and re-attaches CDP after the app's stat is missing two ticks in a row", async () => {
    let restarted = false;
    const gone = fixture("head-tick-1.txt").replace(/==> \/proc\/23811\/stat <==\n.*\n/, "");
    const run = tickRunner(args => (restarted && isTick(args) ? ok(gone) : undefined));
    const ctx = await watched(run);
    const probes = (): number => count(ctx, args => args[4] === "/proc/net/unix");
    await vi.advanceTimersByTimeAsync(1500);
    expect(probes()).toBe(1);

    restarted = true;
    await vi.advanceTimersByTimeAsync(2000);
    expect(ctx.cdp.sockets[0]?.closed).toBe(true);
    restarted = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(probes()).toBe(2);
    expect(ctx.cdp.sockets).toHaveLength(2);
    expect(ctx.cdp.sockets[1]?.closed).toBe(false);
  });

  it("degrades one reading alone: app meminfo failing and GPU nodes gone", async () => {
    let ticks = 0;
    const run = fakeRunner(args => {
      if (args[3] === "dumpsys" && args[5] === String(PIDS.app)) {
        return { code: 1, text: "", missing: false };
      }
      if (!isTick(args)) return a26(args);
      ticks += 1;
      const text = fixture(ticks % 2 === 1 ? "head-tick-1.txt" : "head-tick-2.txt");
      return ok(text.replace(/==> \/sys\/kernel\/gpu[\s\S]*$/, ""));
    });
    const ctx = await watched(run);
    await vi.advanceTimersByTimeAsync(2000);
    const second = records(ctx)[1];
    expect(second?.gpu).toEqual({
      available: false,
      source: "/sys/kernel/gpu",
      reason: "unreadable"
    });
    expect(second?.memory.app).toEqual({
      available: false,
      source: "dumpsys meminfo",
      reason: "error"
    });
    expect(second?.memory.renderer.available).toBe(true);
    expect(second?.cpu.app.available).toBe(true);
    expect(second?.heap.available).toBe(true);
  });

  it("detaches CDP when its socket closes by itself and re-probes on the next tick", async () => {
    const ctx = await watched();
    await vi.advanceTimersByTimeAsync(1500);
    ctx.cdp.sockets[0]?.events.onClose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctx.state.forwards.size).toBe(1);
    expect(ctx.cdp.sockets).toHaveLength(2);
    expect(count(ctx, args => args[4] === "/proc/net/unix")).toBe(2);
  });
});
