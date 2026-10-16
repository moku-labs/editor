import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerCore, createServerPlugin, serverCoreConfig } from "../../../../config";
import { connectPlugin } from "../../../connect";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../../../hub";
import type { Client } from "../../../hub/__tests__/integration/clients";
import {
  connectClient,
  connectDevice,
  isNote,
  isResponseTo,
  paramsOf
} from "../../../hub/__tests__/integration/clients";
import type { PairConfirm } from "../../../hub/types";
import type { Json, Message } from "../../../registry/protocol";
import { notification, request } from "../../../registry/protocol";
import { collectorPlugin } from "../..";
import type { AdbResult, CollectorSessionEvent } from "../../types";
import { eventLine, fileLines, headerLine, sampleLine, spikeLine } from "../helpers";

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
// The real app (files on a temp root, hub on devicePort 0, connect, the
// collector with a fake adb, and a plugin that depends on the collector): a
// phone pairs over the adb listener, sends its log, drops, comes back with its
// token and resends one overlapping batch; a poll and a computer mark join the
// same file. With connect's adb a fake script (the A26's fixtures), a watched
// wired phone's telemetry ticks join its recording log until its recorder stop
// line.
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
  plugins: [filesPlugin, hubPlugin, connectPlugin, collectorPlugin, liveLinePlugin]
});

const LOG = "perf-20261014-1532-sm-a266b.jsonl";

/** An adb command no machine has: connect's scan finds adb missing and runs nothing. */
const NO_ADB = "moku-collector-no-adb";

let base: string;
let app: ReturnType<typeof framework.createApp> | undefined;
let server: ReturnType<typeof Bun.serve> | undefined;
const clients: Client[] = [];
let calls = 0;

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

/**
 * Writes the shell wrapper that runs the fake adb (`fixtures/fake-adb.ts`) with this Bun.
 *
 * @param dir - The folder of the wrapper.
 * @returns The wrapper's path, for `connect.adb`.
 */
async function fakeAdb(dir: string): Promise<string> {
  const script = join(import.meta.dirname, "../fixtures/fake-adb.ts");
  const adb = join(dir, "adb");
  await writeFile(adb, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  await chmod(adb, 0o755);
  return adb;
}

/**
 * Calls an editor method over a tools socket.
 *
 * @param tools - The tools client.
 * @param method - The method.
 * @param params - Its params.
 * @returns The result; a wire error throws.
 */
async function call(tools: Client, method: string, params?: Json): Promise<Json | undefined> {
  calls += 1;
  const id = calls;
  tools.send(request(id, "editor", method, params));
  const answer: Message = await tools.next(isResponseTo(id), 8000);
  if ("error" in answer) throw new Error(answer.error.message);
  return "result" in answer ? answer.result : undefined;
}

/**
 * Matches the phone's `perf.ack` of a batch by the index after it.
 *
 * @param next - The ack's `next`.
 * @returns The matcher.
 */
function isAck(next: number): (message: Message) => boolean {
  return message => isNote("editor", "perf.ack")(message) && paramsOf(message)?.next === next;
}

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await app?.stop();
  app = undefined;
  await server?.stop(true);
  server = undefined;
  await rm(base, { recursive: true, force: true });
});

describe("collector over a real hub", () => {
  it("records a phone's log in one file across a reconnect, adds a poll and a computer mark, and stops cleanly", async () => {
    const editor = framework.createApp({
      pluginConfigs: {
        files: { root: base, project: false },
        hub: { devicePort: 0 },
        connect: { adb: NO_ADB },
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

describe("wired telemetry in the device log", () => {
  it("writes a watched wired phone's telemetry ticks into its recording log between its own lines, and none after its recorder stop line", async () => {
    const adb = await fakeAdb(base);
    const editor = framework.createApp({
      pluginConfigs: {
        files: { root: base, project: false },
        hub: { devicePort: 0 },
        connect: { adb, scanEveryMs: 500, telemetryEveryMs: 250, meminfoEveryMs: 60_000 },
        collector: { out: "perf" }
      }
    });
    app = editor;
    await editor.start();
    server = Bun.serve(editor.hub.serve({ port: 0, fetch: () => new Response("game") }));
    const tools = await connectClient(server.port ?? 0, {
      token: editor.hub.token(),
      kind: "tools"
    });
    clients.push(tools);

    const wired = (await call(tools, "connect.wire")) as { readonly listen: { adb: string } };
    const phone = await connectDevice(wired.listen.adb);
    clients.push(phone);
    phone.send(notification("editor", "pair", { code: "4821", device: { model: "SM-A266B" } }));
    const device = String(paramsOf(await phone.next(isNote("editor", "paired"), 8000))?.device);
    const start = { action: "start", label: "boss", by: "phone" };
    phone.send(batch(0, [headerLine(100), eventLine(150, "recorder", start), sampleLine(1100)]));
    await phone.next(isAck(3), 8000);
    await vi.waitFor(
      () =>
        expect(editor.connect.directory().wire.some(entry => entry.device === device)).toBe(true),
      { timeout: 8000, interval: 100 }
    );

    await expect(call(tools, "connect.watch", { device })).resolves.toEqual({ wired: true });
    const file = editor.collector.sessions()[0]?.file ?? "";
    const hasTelemetry = async () => {
      await editor.collector.settled();
      const written = await fileLines(file);
      return written.some(line => line.kind === "telemetry");
    };
    await vi.waitFor(async () => expect(await hasTelemetry()).toBe(true), {
      timeout: 8000,
      interval: 100
    });
    phone.send(batch(3, [sampleLine(2100)]));
    await phone.next(isAck(4), 8000);
    phone.send(batch(4, [eventLine(2200, "recorder", { action: "stop" })]));
    await phone.next(isAck(5), 8000);
    const stoppedAt = Date.now();
    await vi.waitFor(
      () => expect(editor.connect.telemetry(device)?.at ?? 0).toBeGreaterThan(stoppedAt),
      { timeout: 8000, interval: 50 }
    );
    await editor.collector.settled();
    await editor.stop();
    app = undefined;

    const lines = await fileLines(file);
    const indexOf = (match: (line: (typeof lines)[number]) => boolean) =>
      lines.findIndex(line => match(line));
    const firstTelemetry = indexOf(line => line.kind === "telemetry");
    const before = indexOf(line => line.kind === "sample" && line.t === 1100);
    const after = indexOf(line => line.kind === "sample" && line.t === 2100);
    const stop = indexOf(line => line.kind === "event" && line.t === 2200);
    expect(before).toBeLessThan(firstTelemetry);
    expect(firstTelemetry).toBeLessThan(after);
    expect(after).toBeLessThan(stop);
    expect(lines.slice(stop + 1).filter(line => line.kind === "telemetry")).toEqual([]);
    const telemetry = lines[firstTelemetry];
    expect(telemetry).toMatchObject({
      v: 1,
      device: "SM-A266B",
      serial: "R5CX30ABCDE",
      wired: true,
      gpu: { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: 63 } },
      // The first tick's CPU has no delta yet: verbatim, it names its source either way.
      cpu: { cores: 8, surfaceflinger: { source: "/proc/612/stat" } },
      heap: { available: false, reason: "no-devtools-socket" }
    });
    expect(typeof telemetry?.rx).toBe("number");
    expect(Number(telemetry?.t)).toBeGreaterThan(1100);
    expect(Number(telemetry?.t)).toBeLessThan(60_000);
  }, 30_000);
});
