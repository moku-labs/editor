import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerCore, createServerPlugin, serverCoreConfig } from "../../../../config";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../../../hub";
import type { Client } from "../../../hub/__tests__/integration/clients";
import { connectDevice, isNote, paramsOf } from "../../../hub/__tests__/integration/clients";
import type { PairConfirm } from "../../../hub/types";
import type { Json } from "../../../registry/protocol";
import { notification } from "../../../registry/protocol";
import { collectorPlugin } from "../..";
import type { AdbResult, CollectorSessionEvent } from "../../types";
import { fileLines, headerLine, sampleLine, spikeLine } from "../helpers";

vi.mock("../../adb/run", () => ({
  runAdb: vi.fn(async (_command: string, args: readonly string[]): Promise<AdbResult> => {
    const command = args.join(" ");
    const ok = (text: string): AdbResult => ({ code: 0, text, missing: false });
    if (command === "devices") return ok("List of devices attached\nR5CX30ABCDE\tdevice\n");
    if (command.endsWith("getprop ro.product.model")) return ok("SM-A266B\n");
    if (command.endsWith("dumpsys battery")) return ok("  temperature: 351\n");
    if (command.endsWith("dumpsys thermalservice")) return ok("Thermal Status: 1\n");
    return ok("");
  })
}));

// ─────────────────────────────────────────────────────────────────────────────
// The real app (files on a temp root, hub on devicePort 0, the collector with a
// fake adb, and a plugin that depends on the collector): a phone pairs over the
// adb listener, sends its log, drops, comes back with its token and resends one
// overlapping batch; a poll and a computer mark join the same file.
// ─────────────────────────────────────────────────────────────────────────────

/** Every collector:session the dependent plugin saw. */
const sessions: CollectorSessionEvent[] = [];

/**
 * The hooks of the dependent plugin.
 *
 * @returns The hook map.
 */
function liveLineHooks() {
  return {
    "collector:session": (event: CollectorSessionEvent) => {
      sessions.push(event);
    }
  };
}

const liveLinePlugin = createServerPlugin("liveLine", {
  depends: [collectorPlugin],
  hooks: liveLineHooks
});

const framework = createServerCore(serverCoreConfig, {
  plugins: [filesPlugin, hubPlugin, collectorPlugin, liveLinePlugin]
});

const LOG = "perf-20261014-1532-sm-a266b.jsonl";

let base: string;
let app: ReturnType<typeof framework.createApp> | undefined;
const clients: Client[] = [];

/**
 * A perf.lines batch.
 *
 * @param from - Index of the first line.
 * @param lines - The lines.
 * @returns The notification.
 */
function batch(from: number, lines: readonly object[]) {
  // eslint-disable-next-line unicorn/prefer-structured-clone -- the wire form: JSON values, not a clone
  const wire: Json[] = lines.map(line => JSON.parse(JSON.stringify(line)));
  return notification("editor", "perf.lines", { log: LOG, from, lines: wire });
}

beforeEach(async () => {
  sessions.length = 0;
  base = await mkdtemp(join(tmpdir(), "moku-collector-it-"));
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await app?.stop();
  app = undefined;
  await rm(base, { recursive: true, force: true });
});

describe("collector over a real hub", () => {
  it("records a phone's log in one file across a reconnect, adds a poll and a computer mark, and stops cleanly", async () => {
    const editor = framework.createApp({
      pluginConfigs: {
        files: { root: base, project: false },
        hub: { devicePort: 0 },
        collector: { out: "perf", everyS: 1 }
      }
    });
    app = editor;
    await editor.start();
    const listen = await editor.hub.listenDevices({
      confirm: vi.fn<PairConfirm>(async () => false)
    });

    const phone = await connectDevice(listen.adb);
    clients.push(phone);
    phone.send(notification("editor", "pair", { code: "4821", device: { model: "sm a266b" } }));
    const paired = paramsOf(await phone.next(isNote("editor", "paired")));
    const credentials = { device: String(paired?.device), token: String(paired?.token) };
    phone.send(batch(0, [headerLine(100), sampleLine(1100), spikeLine(1200, ["upload"])]));
    await phone.next(isNote("editor", "perf.ack"));
    phone.close();
    await phone.closed;
    await vi.waitFor(() => expect(editor.collector.sessions()[0]?.state).toBe("away"));

    const again = await connectDevice(listen.adb, credentials);
    clients.push(again);
    again.send(batch(2, [spikeLine(1200, ["upload"]), sampleLine(2100), sampleLine(3100)]));
    await again.next(isNote("editor", "perf.ack"));

    const [session] = editor.collector.sessions();
    const file = session?.file ?? "";
    expect(file.startsWith(join(await realpath(base), "perf/"))).toBe(true);
    expect(file).toMatch(/\/perf-\d{8}-\d{4}-sm-a266b\.jsonl$/);
    const pollAfterReconnect = async () => {
      const written = await fileLines(file);
      return written.some(line => line.kind === "thermal" && Number(line.t) > 3100);
    };
    await vi.waitFor(async () => expect(await pollAfterReconnect()).toBe(true), {
      timeout: 4000,
      interval: 100
    });

    const response = await fetch(`http://${listen.adb}/__editor/perf/mark`, {
      method: "POST",
      headers: { authorization: `Bearer ${editor.hub.token()}` },
      body: "boss"
    });
    expect(await response.json()).toEqual({ marked: 1 });
    expect(sessions.at(-1)).toMatchObject({ file, state: "live" });
    expect(sessions.some(event => event.state === "away")).toBe(true);

    await editor.stop();
    app = undefined;

    const lines = await fileLines(file);
    const device = lines.filter(line => line.from !== "computer" && line.source !== "collector");
    expect(device.map(line => [line.kind, line.t])).toEqual([
      ["header", 100],
      ["sample", 1100],
      ["spike", 1200],
      ["sample", 2100],
      ["sample", 3100]
    ]);
    expect(lines.every(line => typeof line.rx === "number")).toBe(true);
    const thermal = lines.findLast(line => line.kind === "thermal");
    expect(thermal).toMatchObject({
      source: "collector",
      device: "SM-A266B",
      status: 1,
      batteryC: 35.1
    });
    expect(Number(thermal?.t)).toBeGreaterThan(3100);
    expect(Number(thermal?.t)).toBeLessThan(60_000);
    expect(lines.find(line => line.kind === "mark")).toMatchObject({
      label: "boss",
      from: "computer"
    });
    expect(editor.collector.sessions()).toMatchObject([{ state: "done", stopTimedOut: false }]);
    await expect(rm(file)).resolves.toBeUndefined();
  });
});
