/* eslint-disable unicorn/no-null -- localStorage answers null for a missing key */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import type { LogEntry } from "@moku-labs/common/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeMonitor } from "../../../../../tests/fixtures/fake-monitor";
import { createFakeMonitor, sampleLine } from "../../../../../tests/fixtures/fake-monitor";
import type { TinyHeadless } from "../../../../../tests/fixtures/tiny-screen-game";
import { startTinyHeadless } from "../../../../../tests/fixtures/tiny-screen-game";
import type { AgentEvents } from "../../../../config";
import {
  agentCoreConfig,
  createAgentCore,
  createAgentPlugin,
  createServerCore,
  createServerPlugin,
  serverCoreConfig
} from "../../../../config";
import { channelPlugin } from "../../../channel";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../../../hub";
import type { HubDeviceEvent, PairConfirm, PairRequest } from "../../../hub/types";
import { perfPlugin } from "../../../perf";
import { recorderPlugin } from "../../../recorder";
import { registryPlugin } from "../../../registry";
import type { GameLike } from "../../../registry/types";
import { bridgePlugin } from "../..";
import { PAIRING_STORE_KEY } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// Device mode end to end: the real agent core [registry, channel, perf,
// recorder, bridge] over the headless tiny game with the fake monitor, linked
// to the real hub's device listener (files + hub on devicePort 0). The
// WebSocket global plays the native WebView: it sends the shell's Origin and
// records what the phone sends and closes.
// ─────────────────────────────────────────────────────────────────────────────

const phoneCore = createAgentCore(agentCoreConfig, {
  plugins: [registryPlugin, channelPlugin, perfPlugin, recorderPlugin, bridgePlugin]
});

/** Every hub:device event of the computers. */
const deviceEvents: HubDeviceEvent[] = [];

/** Records the hub's per-plugin device events. */
const deviceLogPlugin = createServerPlugin("deviceLog", {
  depends: [hubPlugin],
  hooks: () => ({
    "hub:device": (event: HubDeviceEvent) => {
      deviceEvents.push(event);
    }
  })
});

const computerCore = createServerCore(serverCoreConfig, {
  plugins: [filesPlugin, hubPlugin, deviceLogPlugin]
});

/** Every bridge:status the phone emitted. */
const statuses: AgentEvents["bridge:status"][] = [];

/** Records bridge:status. */
const spyPlugin = createAgentPlugin("spy", {
  hooks: () => ({
    "bridge:status": (payload: AgentEvents["bridge:status"]) => {
      statuses.push(payload);
    }
  })
});

/** The overlay's Link tab, as a test plugin: it asks for another computer by the global intent. */
const linkTabPlugin = createAgentPlugin("linkTab", {
  api: ctx => ({
    connect: (address: string): void => {
      ctx.emit("overlay:connect", { address });
    }
  })
});

/** The shell's Origin (Android, native#19). */
const SHELL_ORIGIN = "http://tauri.localhost";

/** How long the 4401 re-pair may take: under the 8 s minimum backoff of a 10 s retryMs. */
const REPAIR_BOUND_MS = 6000;

/** The phone's engine and build (the debug build's globals). */
const ENGINE = "0.14.12+9c41e0";
const BUILD = "debug-20261014T160000Z";

/** One socket the phone opened: what it sent and how it closed itself. */
type PhoneSocket = {
  readonly url: string;
  readonly sent: string[];
  readonly closes: { code: number | undefined; reason: string | undefined }[];
  /** Close the socket right after the next `perf.lines` it sends. */
  breakAfterLines: boolean;
};

const sockets: PhoneSocket[] = [];
const stops: (() => Promise<unknown>)[] = [];
const logs: LogEntry[] = [];
const storage = new Map<string, string>();
let base: string;
let game: TinyHeadless;

/** The platform WebSocket, wrapped below. */
const PlatformSocket = globalThis.WebSocket;

/**
 * The WebView's WebSocket: it sends the shell's Origin itself (the bridge passes none in device
 * mode) and records the phone's traffic.
 */
class ShellSocket extends PlatformSocket {
  readonly record: PhoneSocket;

  constructor(url: string | URL) {
    const options: unknown = { headers: { origin: SHELL_ORIGIN } };
    super(url, options as string);
    this.record = { url: String(url), sent: [], closes: [], breakAfterLines: false };
    sockets.push(this.record);
  }

  override send(text: string): void {
    this.record.sent.push(text);
    super.send(text);
    if (this.record.breakAfterLines && text.includes('"perf.lines"')) {
      this.record.breakAfterLines = false;
      super.close();
    }
  }

  override close(code?: number, reason?: string): void {
    this.record.closes.push({ code, reason });
    super.close(code, reason);
  }
}

/**
 * Polls until `probe` returns a value other than undefined.
 *
 * @param probe - What to wait for.
 * @param timeoutMs - How long to wait.
 * @returns The value.
 */
async function waitFor<T>(probe: () => T | undefined, timeoutMs = 5000): Promise<T> {
  const until = Date.now() + timeoutMs;
  for (;;) {
    const value = probe();
    if (value !== undefined) return value;
    if (Date.now() > until) throw new Error("waitFor timed out");
    await sleep(5);
  }
}

/**
 * Sleeps.
 *
 * @param ms - Milliseconds.
 */
async function sleep(ms: number): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Starts a computer in device mode on a free port.
 *
 * @param options - The hub's pairing rule and the person at the terminal.
 * @param options.pairing - "lan" confirms an adb phone at once; "always" asks.
 * @param options.confirm - The person's answer.
 * @returns The editor and its adb address.
 */
async function startComputer(options: { pairing?: "lan" | "always"; confirm?: PairConfirm } = {}) {
  const editor = computerCore.createApp({
    pluginConfigs: {
      files: { root: base, project: false },
      hub: { devicePort: 0, pairing: options.pairing ?? "lan" }
    }
  });
  editor.log.clearSinks();
  await editor.start();
  stops.push(() => editor.stop());
  const listen = await editor.hub.listenDevices({
    confirm: options.confirm ?? (async () => false)
  });
  return { editor, address: listen.adb };
}

/**
 * Starts the phone: a debug build whose `--editor` named `address`.
 *
 * @param address - The computer's address.
 * @param retryMs - The bridge's first reconnect delay.
 * @returns The agent app and the monitor.
 */
async function startPhone(address: string, retryMs = 100) {
  vi.stubGlobal("__MOKU_GAME_EDITOR__", address);
  const monitor: FakeMonitor = createFakeMonitor({ capacity: 64 });
  const grafted: GameLike = Object.create(game.app, { renderer: { value: { monitor } } });
  const app = phoneCore.createApp({
    plugins: [spyPlugin, linkTabPlugin],
    pluginConfigs: {
      registry: { game: grafted, name: "tiny-screen 0.0.0" },
      channel: { heartbeatMs: 100 },
      recorder: { storage: "memory", flushEveryMs: 100 },
      bridge: { retryMs, callTimeoutMs: 2000 }
    }
  });
  app.log.clearSinks();
  app.log.addSink({
    write: entry => {
      logs.push(entry);
    }
  });
  await app.start();
  stops.push(() => app.stop());
  return { app, monitor };
}

/**
 * The JSON messages a phone socket sent.
 *
 * @param socket - The socket.
 * @returns Their decoded texts.
 */
function sentBy(socket: PhoneSocket | undefined): { method?: string; params?: unknown }[] {
  return (socket?.sent ?? []).map(
    text => JSON.parse(text) as { method?: string; params?: unknown }
  );
}

/**
 * The bridge log lines of a level.
 *
 * @param level - The level.
 * @returns Their events.
 */
function bridgeLogs(level: LogEntry["level"]): string[] {
  return logs
    .filter(entry => entry.level === level && entry.event.startsWith("bridge:"))
    .map(entry => entry.event);
}

beforeEach(async () => {
  // A plain --debug build: DEV false, AGENT true, CONTROL false (engine spec 10).
  vi.stubGlobal("__MOKU_GAME_DEV__", false);
  vi.stubGlobal("__MOKU_GAME_AGENT__", true);
  vi.stubGlobal("__MOKU_GAME_CONTROL__", false);
  vi.stubGlobal("__MOKU_GAME_ENGINE__", ENGINE);
  vi.stubGlobal("__MOKU_GAME_BUILD__", BUILD);
  vi.stubGlobal("WebSocket", ShellSocket);
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key)
  });
  base = await mkdtemp(join(tmpdir(), "moku-bridge-device-"));
  game = await startTinyHeadless();
});

afterEach(async () => {
  for (const stop of stops.splice(0).toReversed()) await stop();
  await game.stop();
  await rm(base, { recursive: true, force: true });
  vi.unstubAllGlobals();
  sockets.length = 0;
  statuses.length = 0;
  deviceEvents.length = 0;
  logs.length = 0;
  storage.clear();
});

describe("bridge device mode against the hub's device listener", { timeout: 15_000 }, () => {
  it("shows the code, pairs when the person confirms, says hello with the build and links live over adb", async () => {
    const requests: PairRequest[] = [];
    const answers: ((ok: boolean) => void)[] = [];
    const confirm: PairConfirm = request => {
      requests.push(request);
      return new Promise(resolve => {
        answers.push(resolve);
      });
    };
    const { editor, address } = await startComputer({ pairing: "always", confirm });

    const { app } = await startPhone(address);
    const waiting = await waitFor(() => statuses.find(status => status.link?.pairing)?.link);
    expect(waiting).toEqual({
      mode: "connecting",
      address,
      pairing: { code: expect.stringMatching(/^\d{4}$/) }
    });
    const request = await waitFor(() => requests[0]);
    expect(request).toMatchObject({
      code: waiting.pairing?.code,
      link: "adb",
      engine: ENGINE,
      build: BUILD
    });
    expect(sockets[0]?.url).toBe(`ws://${address}/__editor/ws?kind=agent&role=device`);

    answers[0]?.(true);
    const live = await waitFor(() => {
      const link = app.bridge.link();
      return link?.mode === "adb" && link.editorEngine !== undefined ? link : undefined;
    });

    expect(live).toMatchObject({ mode: "adb", address, editorEngine: editor.files.engine().id });
    expect(live.pairing).toBeUndefined();
    const [pair, hello] = sentBy(sockets[0]);
    expect(pair?.method).toBe("pair");
    expect(hello).toMatchObject({
      method: "hello",
      params: { manifest: { build: { profile: "read", id: BUILD, engine: ENGINE } } }
    });
    expect(app.bridge.status()).toMatchObject({ kind: "live" });
    expect(editor.hub.devices()).toMatchObject([{ link: "adb", engine: ENGINE, online: true }]);
  });

  it("remembers the credentials: a second start links without pairing", async () => {
    const confirm = vi.fn<PairConfirm>(async () => true);
    const { editor, address } = await startComputer({ pairing: "always", confirm });
    const first = await startPhone(address);
    await waitFor(() => (first.app.bridge.link()?.mode === "adb" ? true : undefined));
    expect(JSON.parse(storage.get(PAIRING_STORE_KEY) ?? "{}").last).toBe(address);
    await first.app.stop();

    const second = await startPhone(address);
    await waitFor(() => (second.app.bridge.link()?.mode === "adb" ? true : undefined));

    expect(confirm).toHaveBeenCalledOnce();
    expect(sockets.at(-1)?.url).toContain("&device=");
    expect(sentBy(sockets.at(-1))[0]?.method).toBe("hello");
    expect(editor.hub.devices()).toHaveLength(1);
  });

  it("pairs again at once when the hub does not know the token (4401), without the backoff", async () => {
    const { address } = await startComputer();
    storage.set(
      PAIRING_STORE_KEY,
      JSON.stringify({
        v: 1,
        last: address,
        links: { [address]: { device: "d-0000", token: "x".repeat(43) } }
      })
    );

    const { app } = await startPhone(address, 10_000);
    // The stale socket opens and shows adb until the hub's 4401 arrives: wait for the second
    // socket to pair and link. The bound stays under the 8 s minimum backoff (10 s − 20 %), so a
    // re-pair that waited for the backoff still fails here.
    await waitFor(
      () =>
        sockets.length >= 2 &&
        logs.some(entry => entry.event === "bridge:paired") &&
        app.bridge.link()?.mode === "adb"
          ? true
          : undefined,
      REPAIR_BOUND_MS
    );

    expect(sockets.map(socket => socket.url.includes("&token="))).toEqual([true, false]);
    expect(sentBy(sockets[1])[0]?.method).toBe("pair");
    expect(JSON.parse(storage.get(PAIRING_STORE_KEY) ?? "{}").links[address].device).not.toBe(
      "d-0000"
    );
    expect(logs.some(entry => entry.event === "bridge:unpaired")).toBe(true);
    expect(JSON.stringify(logs)).not.toContain("x".repeat(43));
  });

  it("ships the recorder's log: every line reaches the hub exactly once across a forced close", async () => {
    const { address } = await startComputer();
    const { app, monitor } = await startPhone(address);
    await waitFor(() => (app.bridge.link()?.mode === "adb" ? true : undefined));
    for (let frame = 1; frame <= 40; frame += 1) monitor.emit(sampleLine(frame));
    const linked = sockets.at(-1);
    if (linked !== undefined) linked.breakAfterLines = true;
    for (let frame = 41; frame <= 80; frame += 1) monitor.emit(sampleLine(frame));

    await waitFor(() => (sockets.length >= 2 ? true : undefined));
    await waitFor(() => (app.recorder.status().pending === 0 ? true : undefined));
    const log = app.recorder.files()[0];

    const indices = deviceEvents.flatMap(event =>
      event.kind === "lines" && event.lines.log === log?.name
        ? event.lines.items.map((_, index) => event.lines.from + index)
        : []
    );
    expect(indices).toEqual(Array.from({ length: log?.lines ?? 0 }, (_, index) => index));
    expect(deviceEvents.every(event => event.kind !== "lines" || event.lines.gap === 0)).toBe(true);
    expect(sentBy(sockets[1]).some(message => message.method === "perf.lines")).toBe(true);
  });

  it("starts with no computer listening, quietly: one info line and the backoff", async () => {
    const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response("") });
    const address = `127.0.0.1:${String(probe.port)}`;
    await probe.stop(true);

    const { app } = await startPhone(address);
    await waitFor(() =>
      sockets.length >= 3 && app.bridge.status().kind === "lost" ? true : undefined
    );

    expect(app.bridge.link()).toMatchObject({ mode: "none", address });
    expect(bridgeLogs("info")).toEqual(["bridge:no-computer"]);
    expect(bridgeLogs("warn")).toEqual([]);
  });

  it("moves to another computer on overlay:connect", async () => {
    const first = await startComputer();
    const second = await startComputer();
    const { app } = await startPhone(first.address);
    await waitFor(() => (app.bridge.link()?.mode === "adb" ? true : undefined));

    app.linkTab.connect(second.address);
    const moved = await waitFor(() => {
      const link = app.bridge.link();
      return link?.address === second.address && link.mode === "adb" ? link : undefined;
    });

    expect(moved.address).toBe(second.address);
    expect(sockets[0]?.closes).toEqual([{ code: 1000, reason: "switch" }]);
    expect(second.editor.hub.devices()).toMatchObject([{ online: true }]);
    expect(JSON.parse(storage.get(PAIRING_STORE_KEY) ?? "{}").last).toBe(second.address);
  });

  it("says bye and closes 1000 on stop: the hub closes the device session with bye", async () => {
    const { address } = await startComputer();
    const { app } = await startPhone(address);
    await waitFor(() => (app.bridge.link()?.mode === "adb" ? true : undefined));

    await app.stop();
    const closed = await waitFor(() => deviceEvents.find(event => event.kind === "closed"));

    expect(sentBy(sockets[0]).at(-1)?.method).toBe("bye");
    expect(sockets[0]?.closes).toEqual([{ code: 1000, reason: "bye" }]);
    expect(closed).toMatchObject({ kind: "closed", reason: "bye" });
  });
});
