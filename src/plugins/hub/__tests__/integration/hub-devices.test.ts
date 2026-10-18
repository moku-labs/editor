import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createServerCore, createServerPlugin, serverCoreConfig } from "../../../../config";
import { filesPlugin } from "../../../files";
import type { Json } from "../../../registry/protocol";
import { notification, toWireValue } from "../../../registry/protocol";
import { hubPlugin } from "../..";
import type { DeviceListen, HubDeviceEvent, PairConfirm } from "../../types";
import type { Client } from "./clients";
import { AGENT_MANIFEST, connectClient, connectDevice, isNote, paramsOf } from "./clients";

// ─────────────────────────────────────────────────────────────────────────────
// Device mode over real listeners: the real app (files, hub, and a plugin that
// depends on hubPlugin and records hub:device) on devicePort 0. A Bun WebSocket
// client with Origin tauri://localhost plays the phone on the adb listener.
// ─────────────────────────────────────────────────────────────────────────────

/** Every hub:device event the recording plugin saw. */
const events: HubDeviceEvent[] = [];

/**
 * The hooks of the recording plugin.
 *
 * @returns The hook map.
 */
function deviceHooks() {
  return {
    "hub:device": (event: HubDeviceEvent) => {
      events.push(event);
    }
  };
}

const deviceLogPlugin = createServerPlugin("deviceLog", {
  depends: [hubPlugin],
  hooks: deviceHooks
});

const framework = createServerCore(serverCoreConfig, {
  plugins: [filesPlugin, hubPlugin, deviceLogPlugin]
});

const LOG = "perf-20261014-1532-sm-a266b.jsonl";

let base: string;
let app: ReturnType<typeof framework.createApp> | undefined;
const clients: Client[] = [];

/**
 * Starts the app in device mode on a random port; the confirm refuses (an adb phone is never asked).
 *
 * @returns The app and where device mode listens.
 */
async function startDevices(): Promise<{
  editor: ReturnType<typeof framework.createApp>;
  listen: DeviceListen;
}> {
  const editor = framework.createApp({
    pluginConfigs: { files: { root: base, project: false }, hub: { devicePort: 0 } }
  });
  app = editor;
  await editor.start();
  const confirm = vi.fn<PairConfirm>(async () => false);
  const listen = await editor.hub.listenDevices({ confirm });
  return { editor, listen };
}

/**
 * Remembers a client for cleanup.
 *
 * @param client - The client.
 * @returns The same client.
 */
function keep(client: Client): Client {
  clients.push(client);
  return client;
}

/**
 * A perf.lines batch of consecutive sample lines.
 *
 * @param from - Index of the first line.
 * @param count - How many lines.
 * @returns The notification.
 */
function batch(from: number, count: number) {
  const lines: Json[] = Array.from({ length: count }, (_, index) => ({
    v: 1,
    kind: "sample",
    t: from + index
  }));
  return notification("editor", "perf.lines", { log: LOG, from, lines });
}

/**
 * The params of every perf.ack a phone got.
 *
 * @param phone - The phone.
 * @returns The acks.
 */
function acks(phone: Client) {
  return phone.messages.filter(isNote("editor", "perf.ack")).map(note => paramsOf(note));
}

beforeEach(async () => {
  events.length = 0;
  base = await mkdtemp(join(tmpdir(), "moku-hub-devices-"));
});

afterEach(async () => {
  for (const client of clients.splice(0)) client.close();
  await app?.stop();
  app = undefined;
  await rm(base, { recursive: true, force: true });
});

describe("hub device mode over real sockets", () => {
  it("pairs a phone over adb, takes its log, shows its session to tools, and stops cleanly", async () => {
    const { editor, listen } = await startDevices();
    const engine = editor.files.engine();
    expect(listen.port).toBeGreaterThan(0);
    expect(listen.port).not.toBe(47_600);

    const phone = keep(await connectDevice(listen.adb));
    phone.send(
      notification("editor", "pair", {
        code: "4821",
        device: { model: "sm a266b", engine: "0.14.12+9c41e0", build: "debug-1" }
      })
    );
    const paired = paramsOf(await phone.next(isNote("editor", "paired")));
    expect(paired).toEqual({
      device: expect.stringMatching(/^d-[\da-f]{4}$/),
      token: expect.any(String),
      engine: engine.id
    });
    const id = String(paired?.device);

    phone.send(notification("game", "hello", { manifest: toWireValue(AGENT_MANIFEST) }));
    const answer = paramsOf(await phone.next(isNote("editor", "session")));
    expect(answer).toMatchObject({ open: true, engine: engine.id });
    phone.send(notification("game", "heartbeat", { frame: 12, paused: false, at: 5 }));

    phone.send(batch(0, 3));
    phone.send(batch(2, 3));
    await vi.waitFor(() => expect(acks(phone)).toHaveLength(2));
    expect(acks(phone)).toEqual([
      { log: LOG, next: 3, n: 3 },
      { log: LOG, next: 5, n: 3 }
    ]);

    const tools = keep(
      await connectClient(listen.port, { token: editor.hub.token(), kind: "tools" })
    );
    const engineNote = await tools.next(isNote("editor", "engine"));
    expect(paramsOf(engineNote)).toEqual({ ...engine });
    const listed = paramsOf(tools.messages.find(isNote("editor", "sessions")))?.list;
    expect(JSON.stringify(listed)).toContain(
      `"device":{"id":"${id}","model":"SM-A266B","link":"adb","address":"127.0.0.1","port":${listen.port}`
    );
    expect(editor.hub.sessions()[0]?.device).toMatchObject({ id, link: "adb", port: listen.port });

    const stale = keep(
      await connectDevice(listen.adb, { device: "d-0000", token: "x".repeat(43) })
    );
    expect(await stale.closed).toEqual({ code: 4401, reason: "unpaired" });

    await vi.waitFor(() =>
      expect(events.some(event => event.kind === "lines" && event.lines.from === 3)).toBe(true)
    );
    const lines = events.flatMap(event =>
      event.kind === "lines" ? [[event.lines.from, event.lines.items.length]] : []
    );
    expect(lines).toEqual([
      [0, 3],
      [3, 2]
    ]);

    await editor.stop();
    app = undefined;
    const closed = await phone.closed;
    expect(closed.code).toBe(1001);
    expect(events.map(event => event.kind)).toEqual(["listening", "connected", "lines", "lines"]);
  });

  it("lets a phone come back with its token: same id, its log indices kept, closed then connected", async () => {
    const { listen } = await startDevices();
    const first = keep(await connectDevice(listen.adb));
    first.send(notification("editor", "pair", { code: "0421", device: { model: "Pixel 8" } }));
    const paired = paramsOf(await first.next(isNote("editor", "paired")));
    const credentials = { device: String(paired?.device), token: String(paired?.token) };
    first.send(batch(0, 3));
    await first.next(isNote("editor", "perf.ack"));
    first.close();
    await first.closed;
    await vi.waitFor(() => expect(events.at(-1)?.kind).toBe("closed"));

    const again = keep(await connectDevice(listen.adb, credentials));
    again.send(batch(0, 5));
    const ack = paramsOf(await again.next(isNote("editor", "perf.ack")));

    expect(ack).toEqual({ log: LOG, next: 5, n: 5 });
    await vi.waitFor(() => expect(events.filter(event => event.kind === "lines")).toHaveLength(2));
    const kinds = events.map(event =>
      event.kind === "closed" ? `closed:${event.reason}` : event.kind
    );
    expect(kinds).toEqual(["listening", "connected", "lines", "closed:lost", "connected", "lines"]);
    const connected = events
      .filter(event => event.kind === "connected")
      .map(event => event.device.id);
    expect(connected).toEqual([credentials.device, credentials.device]);
  });

  it("emits closed (stopped) and stopped on stopDevices, and the listener refuses after it", async () => {
    const { editor, listen } = await startDevices();
    const phone = keep(await connectDevice(listen.adb));
    phone.send(notification("editor", "pair", { code: "4821", device: {} }));
    await phone.next(isNote("editor", "paired"));

    await editor.hub.stopDevices();

    const closed = await phone.closed;
    expect(closed.code).toBe(1001);
    await vi.waitFor(() => expect(events.at(-1)?.kind).toBe("stopped"));
    const kinds = events.map(event =>
      event.kind === "closed" ? `closed:${event.reason}` : event.kind
    );
    expect(kinds).toEqual(["listening", "connected", "closed:stopped", "stopped"]);
    expect(editor.hub.devices()).toEqual([]);
    await expect(connectDevice(listen.adb)).rejects.toThrow();
  });
});
