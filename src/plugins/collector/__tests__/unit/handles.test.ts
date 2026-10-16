import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCollectorApi } from "../../api";
import { createCollectorHooks } from "../../handlers";
import { stopCollector } from "../../lifecycle";
import type { CollectorHooks } from "../../types";
import type { TestCtx } from "../helpers";
import {
  createCtx,
  deviceOf,
  headerLine,
  linesEvent,
  removeDir,
  sampleLine,
  tempDir
} from "../helpers";

/** Every file handle the collector opened and closed through node:fs/promises. */
const counts = vi.hoisted(() => ({ opened: 0, closed: 0 }));

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      counts.opened += 1;
      const close = handle.close.bind(handle);
      handle.close = async () => {
        counts.closed += 1;
        await close();
      };
      return handle;
    }
  };
});

// ─────────────────────────────────────────────────────────────────────────────
// No file handle outlives the collector: every handle it opens through
// node:fs/promises (a new log, a reopen after a close, a computer mark) is
// closed once device mode stops, or once the app stops (bug: a FileHandle left
// for the garbage collector, an error in Node and Bun).
// ─────────────────────────────────────────────────────────────────────────────

let root: string;
let ctx: TestCtx;
let hooks: CollectorHooks;

beforeEach(async () => {
  counts.opened = 0;
  counts.closed = 0;
  root = await tempDir();
  ctx = createCtx(root);
  hooks = createCollectorHooks(ctx);
});

afterEach(async () => {
  await stopCollector(ctx);
  await removeDir(root);
});

describe("file handles", () => {
  it("closes every file it opened once device mode stops: new logs, reopens, reconnects and marks", async () => {
    const api = createCollectorApi(ctx);
    const device = deviceOf();
    hooks["hub:device"]({ kind: "connected", device });
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { log: "perf-2.jsonl" }));
    hooks["hub:device"](linesEvent(device, [sampleLine(3000)], { from: 2 }));
    await api.settled();
    hooks["hub:device"]({ kind: "closed", device: { ...device, online: false }, reason: "lost" });
    hooks["hub:device"]({ kind: "connected", device });
    hooks["hub:device"](linesEvent(device, [sampleLine(4000)], { log: "perf-2.jsonl", from: 1 }));
    await api.mark("boss");
    hooks["hub:device"]({ kind: "stopped" });
    await api.settled();

    expect(counts.opened).toBeGreaterThanOrEqual(5);
    expect(counts.closed).toBe(counts.opened);
  });

  it("closes every open file when the app stops with device mode still on", async () => {
    const api = createCollectorApi(ctx);
    const device = deviceOf();
    hooks["hub:device"](linesEvent(device, [headerLine(0), sampleLine(1000)]));
    hooks["hub:device"](linesEvent(device, [sampleLine(2000)], { log: "perf-2.jsonl" }));
    await api.mark("boss");

    await stopCollector(ctx);

    expect(counts.opened).toBe(3);
    expect(counts.closed).toBe(3);
  });
});
