/* eslint-disable unicorn/no-null -- null is "not reported" in the directories the tests expect */
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createServerCore, serverCoreConfig } from "../../../../config";
import { collectorPlugin } from "../../../collector";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../../../hub";
import { connectPlugin } from "../..";
import type { DeviceDirectory, DeviceTelemetry } from "../../protocol";
import { readDirectory, readTelemetry } from "../../protocol";
import type { Peer } from "./peers";
import { openPeer, pairPhone } from "./peers";

// ─────────────────────────────────────────────────────────────────────────────
// The real server app (files, hub, connect, collector) with a fake adb (a Bun
// script printing the A26's fixtures), a tools WebSocket client and a phone
// client: scan, device mode by wire, a phone pairing over the adb listener,
// wired telemetry (heap off without a devtools socket, then CDP heap samples
// from a fake CDP server), a LAN pairing confirmed in the page, and a stop
// that leaves no forward on the phone.
// ─────────────────────────────────────────────────────────────────────────────

const framework = createServerCore(serverCoreConfig, {
  plugins: [filesPlugin, hubPlugin, connectPlugin, collectorPlugin]
});

/** How long one scenario may run: every adb call spawns the fake adb (a Bun process). */
const TIMEOUT_MS = 30_000;

/** The page the fake phone's game reports. */
const PAGE = "http://tauri.localhost/";

/** Whether this machine has an IPv6 loopback (the LAN listener binds ::1). */
const HAS_IPV6 = ((): boolean => {
  try {
    const probe = Bun.serve({ hostname: "::1", port: 0, fetch: () => new Response("") });
    probe.stop(true).catch(() => undefined);
    return true;
  } catch {
    return false;
  }
})();

/** What one test started, for cleanup. */
type Running = {
  readonly app: ReturnType<typeof framework.createApp>;
  readonly stopServer: () => Promise<void>;
  readonly peers: Peer[];
  readonly dir: string;
  readonly log: string;
  readonly cdp?: { stop(): Promise<void> };
};

let running: Running | undefined;

/**
 * Starts the app with a fake adb of a variant, serves it and opens a tools client.
 *
 * @param variant - "plain" (no devtools socket) or "cdp".
 * @param cdpPort - The port the fake adb's forward prints.
 * @param lan - Whether the hub's LAN address is ::1.
 * @param devicePort - The hub's device port (0: a free one).
 * @returns The app, the tools client and the server port.
 */
async function start(variant: "plain" | "cdp", cdpPort = 0, lan = false, devicePort = 0) {
  const dir = await mkdtemp(path.join(tmpdir(), "moku-connect-"));
  const log = path.join(dir, "adb.log");
  const script = path.join(import.meta.dirname, "../fixtures/fake-adb.ts");
  const adb = path.join(dir, "adb");
  await writeFile(
    adb,
    `#!/bin/sh\nexec "${process.execPath}" "${script}" ${variant} ${cdpPort} "${log}" "$@"\n`
  );
  await chmod(adb, 0o755);

  const app = framework.createApp({
    pluginConfigs: {
      files: { root: dir, project: false },
      hub: { devicePort, ...(lan ? { lanAddress: "::1" } : {}) },
      connect: {
        adb,
        scanEveryMs: 500,
        telemetryEveryMs: 250,
        heapEveryMs: 100,
        meminfoEveryMs: 1000
      },
      collector: { adb }
    }
  });
  await app.start();
  const server = Bun.serve(app.hub.serve({ port: 0, fetch: () => new Response("game") }));
  const port = server.port ?? 0;
  const tools = await openPeer(
    `ws://127.0.0.1:${port}/__editor/ws?token=${app.hub.token()}&kind=tools`,
    `http://127.0.0.1:${port}`
  );
  running = { app, stopServer: () => server.stop(true), peers: [tools], dir, log };
  return { app, tools, port };
}

/**
 * The newest `editor.devices` that passes a check.
 *
 * @param tools - The tools client.
 * @param check - The check.
 * @returns The directory.
 */
async function devicesWhere(
  tools: Peer,
  check: (directory: DeviceDirectory) => boolean
): Promise<DeviceDirectory> {
  const note = await tools.next(message => {
    const directory = message.method === "devices" ? readDirectory(message.params) : undefined;
    return directory !== undefined && check(directory);
  }, 8000);
  const directory = readDirectory(note.params);
  if (directory === undefined) throw new Error("no directory");
  return directory;
}

/**
 * The newest `editor.deviceTelemetry` that passes a check.
 *
 * @param tools - The tools client.
 * @param check - The check.
 * @returns The record.
 */
async function telemetryWhere(
  tools: Peer,
  check: (record: DeviceTelemetry) => boolean
): Promise<DeviceTelemetry> {
  const note = await tools.next(message => {
    const record = message.method === "deviceTelemetry" ? readTelemetry(message.params) : undefined;
    return record !== undefined && check(record);
  }, 8000);
  const record = readTelemetry(note.params);
  if (record === undefined) throw new Error("no record");
  return record;
}

/**
 * Pairs the fake A26 over the adb listener and opens its game session.
 *
 * @param tools - The tools client.
 * @param address - The adb listener.
 * @returns The phone and its device id.
 */
async function linkA26(tools: Peer, address: string): Promise<{ phone: Peer; device: string }> {
  const { phone, device } = await pairPhone(address, { code: "4821", model: "SM-A266B" }, PAGE);
  running?.peers.push(phone);
  await devicesWhere(
    tools,
    directory =>
      directory.wire.some(entry => entry.serial === "R5CX30ABCDE" && entry.phase === "linked") &&
      directory.linked.some(entry => entry.id === device && entry.session !== null)
  );
  return { phone, device };
}

afterEach(async () => {
  const done = running;
  running = undefined;
  if (done === undefined) return;
  for (const peer of done.peers) peer.close();
  await done.app.stop();
  await done.stopServer();
  await done.cdp?.stop();
  await rm(done.dir, { recursive: true, force: true });
});

describe("connect in the real server app", () => {
  it(
    "scans, turns device mode on by wire, links a phone and streams its telemetry",
    async () => {
      const { app, tools } = await start("plain");

      const scanned = readDirectory(await tools.call("connect.scan"));
      expect(scanned?.wire.map(entry => [entry.serial, entry.model, entry.phase])).toEqual([
        ["192.168.1.23:37011", "SM-A256B", "ready"],
        ["R5CX30ABCDE", "SM-A266B", "ready"],
        ["RZ8T20QWERT", null, "unauthorized"],
        ["emulator-5554", null, "offline"]
      ]);

      const wired = (await tools.call("connect.wire")) as { listen: { adb: string; port: number } };
      expect(wired.listen.port).toBeGreaterThan(0);
      await vi.waitFor(() => expect(app.collector.adb().state).toBe("on"));

      const { device } = await linkA26(tools, wired.listen.adb);
      expect(app.connect.directory().mode).toMatchObject({ on: true, owner: "connect" });

      await expect(tools.call("connect.watch", { device })).resolves.toEqual({ wired: true });
      // No devtools socket: the app's pid is not known (no app id on the session yet), surfaceflinger is.
      const record = await telemetryWhere(tools, item => item.cpu.surfaceflinger.available);
      expect(record).toMatchObject({
        device,
        serial: "R5CX30ABCDE",
        wired: true,
        gpu: { available: true, source: "/sys/kernel/gpu", value: { mhz: 221, busyPct: 63 } },
        cpu: {
          cores: 8,
          app: { available: false, reason: "not-found" },
          surfaceflinger: { available: true, source: "/proc/612/stat" }
        },
        heap: { available: false, reason: "no-devtools-socket" }
      });
      expect(app.connect.telemetry(device)?.device).toBe(device);
    },
    TIMEOUT_MS
  );

  it(
    "answers a taken device port as port_in_use through the wire",
    async () => {
      // Bug: the tools page's decoder dropping connect's reason, so the panel cannot say why.
      const taken = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
      try {
        const { tools } = await start("plain", 0, false, taken.port ?? 0);
        await expect(tools.call("connect.wire")).rejects.toMatchObject({
          code: -32_000,
          data: { reason: "port_in_use", retryable: false },
          message: expect.stringContaining("Is moku-editor perf running?")
        });
      } finally {
        await taken.stop(true);
      }
    },
    TIMEOUT_MS
  );

  it(
    "reads the WebView heap over CDP and leaves no forward after stop",
    async () => {
      let samples = 0;
      const cdp = Bun.serve({
        hostname: "127.0.0.1",
        port: 0,
        fetch(req, srv) {
          if (new URL(req.url).pathname === "/json/list") {
            return Response.json([
              {
                type: "page",
                url: `${PAGE}#/play`,
                webSocketDebuggerUrl: `ws://127.0.0.1:${srv.port}/devtools/page/1`
              }
            ]);
          }
          return srv.upgrade(req, { data: undefined })
            ? undefined
            : new Response("no", { status: 400 });
        },
        websocket: {
          message(ws, text) {
            const { id } = JSON.parse(String(text)) as { id: number };
            samples += 1;
            const used = (27 + (samples % 4) * 10) * 1_048_576;
            ws.send(JSON.stringify({ id, result: { usedSize: used, totalSize: 64 * 1_048_576 } }));
          }
        }
      });
      const { app, tools } = await start("cdp", cdp.port ?? 0);
      if (running !== undefined) running = { ...running, cdp: { stop: () => cdp.stop(true) } };

      const wired = (await tools.call("connect.wire")) as { listen: { adb: string } };
      const { device } = await linkA26(tools, wired.listen.adb);
      await tools.call("connect.watch", { device });
      const record = await telemetryWhere(
        tools,
        item => item.heap.available && item.heap.value.samples.length > 0
      );
      expect(record.heap).toMatchObject({ available: true, source: "cdp Runtime.getHeapUsage" });

      const log = running?.log ?? "";
      await app.stop();
      const text = await readFile(log, "utf8");
      const calls = text
        .trim()
        .split("\n")
        .map(line => JSON.parse(line) as string[]);
      const forwarded = calls.filter(args => args[2] === "forward" && args[3] === "tcp:0");
      const removed = calls.filter(args => args[2] === "forward" && args[3] === "--remove");
      expect(forwarded.length).toBeGreaterThan(0);
      expect(removed.map(args => args[4])).toEqual(forwarded.map(() => `tcp:${cdp.port}`));
    },
    TIMEOUT_MS
  );

  it.skipIf(!HAS_IPV6)(
    "keeps a LAN pairing asking until the page types the right code",
    async () => {
      const { tools } = await start("plain", 0, true);
      const network = (await tools.call("connect.network")) as { listen: { lan: string } };
      expect(network.listen.lan).toMatch(/^\[::1\]:\d+$/);

      const pairing = pairPhone(network.listen.lan, { code: "4821", model: "SM-A256B" }, PAGE);
      const asking = await devicesWhere(tools, directory => directory.asking.length === 1);
      const [ask] = asking.asking;
      expect(ask).toMatchObject({ model: "SM-A256B", link: "lan" });
      expect(JSON.stringify(asking)).not.toContain("4821");

      await expect(
        tools.call("connect.confirm", { ticket: ask?.ticket ?? "", code: "4821" })
      ).resolves.toEqual({
        paired: true
      });
      const { phone } = await pairing;
      running?.peers.push(phone);
      await devicesWhere(
        tools,
        directory => directory.asking.length === 0 && directory.linked.length === 1
      );
    },
    TIMEOUT_MS
  );
});
