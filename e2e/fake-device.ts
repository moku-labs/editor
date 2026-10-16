/* eslint-disable unicorn/no-null -- null is a JSON value on the wire (a watch's and an unwatch's answer) */
/**
 * @file The fake phone of M4 (spec 10 Delta 2026-10-16b), run as a Bun child process by
 * e2e/memory.spec.ts:
 *
 *   bun e2e/fake-device.ts --address 127.0.0.1:47600 \
 *     --fixture src/plugins/renderView/__tests__/device-fixtures.ts
 *
 * A WebSocket client with the Origin of a native WebView (`tauri://localhost`) that dials the
 * device listener as a phone would, pairs (the adb listener confirms at once), says hello with the
 * demo phone's manifest (the nine sources Render reads) and answers from the fixtures: frames and
 * events by `after` on read, detail on read, the second and the passes pushed at 1 Hz to a watch,
 * the recorder and the scene's values once. Its page clock starts at the demo's first frame when
 * the process starts. It heartbeats every second. SIGUSR1 closes its socket (the phone leaves),
 * SIGUSR2 dials again with its device id and token (the rejoin path), SIGTERM and SIGINT close and
 * exit. Each step is one stdout line `[fake-device] <step> …` the spec waits for. It shares the
 * wire encoders of registry/protocol (runtime-free) and nothing else of the editor.
 */
import path from "node:path";
import type { Json, Message, Request as RpcRequest } from "../src/plugins/registry/protocol";
import {
  decode,
  encode,
  errorCode,
  failure,
  isRequest,
  notification,
  success,
  toWireValue
} from "../src/plugins/registry/protocol";
import type * as DeviceFixtures from "../src/plugins/renderView/__tests__/device-fixtures";

/** The fixture module's shape. */
type Fixtures = typeof DeviceFixtures;

/** The device id and token the hub issued at pairing. */
type Credentials = { readonly device: string; readonly token: string };

/** One watch the hub forwarded: its source, its input and how to stop its pushes. */
type Watch = { readonly id: string; readonly stop: () => void };

/** The command-line options. */
type Options = { readonly address: string; readonly fixture: string };

/** The Origin a native WebView page sends. */
const ORIGIN = "tauri://localhost";

/** The close code of a dial whose device id or token the hub does not know (hub/protocol). */
const UNPAIRED = 4401;

/** The pairing code the phone shows (an adb phone is confirmed without it). */
const PAIR_CODE = "4821";

/** The heartbeat and the 1 Hz pushes, ms. */
const EVERY_MS = 1000;

/** The sources pushed at 1 Hz to a watch; the others are pushed once. */
const PUSHED_EVERY_SECOND = new Set(["editor.perf.second", "editor.perf.passes"]);

/**
 * Reads `--address` and `--fixture` from the arguments.
 *
 * @param argv - The arguments after the script.
 * @returns The options.
 * @throws {Error} Without `--address`.
 */
function optionsOf(argv: readonly string[]): Options {
  const value = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };
  const address = value("--address");
  if (address === undefined) {
    throw new Error("[fake-device] --address is missing.\n  Pass the device listener's host:port.");
  }
  return {
    address,
    fixture: value("--fixture") ?? "src/plugins/renderView/__tests__/device-fixtures.ts"
  };
}

/**
 * Writes one step to stdout, for the spec to wait on.
 *
 * @param step - The step, e.g. "paired".
 * @param detail - What follows it.
 */
function say(step: string, detail = ""): void {
  const line = detail === "" ? step : `${step} ${detail}`;
  process.stdout.write(`[fake-device] ${line}\n`);
}

/**
 * The members of an object value; empty for anything else.
 *
 * @param value - A Json value.
 * @returns Its members.
 */
function membersOf(value: Json | undefined): { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : {};
}

/**
 * The `after` of a frames or events read: undefined for the first read.
 *
 * @param input - The read's input.
 * @returns The newest frame or seq the reader holds.
 */
function afterOf(input: Json | undefined): number | undefined {
  const after = membersOf(input).after;
  return typeof after === "number" ? after : undefined;
}

const options = optionsOf(Bun.argv.slice(2));
const fixtures: Fixtures = await import(path.resolve(options.fixture));
const started = performance.now();
let socket: WebSocket | undefined;
let credentials: Credentials | undefined;
let beat: ReturnType<typeof setInterval> | undefined;
/** SIGUSR2 came while the socket was still closing. */
let rejoin = false;
const watches = new Map<number, Watch>();

/**
 * The newest frame the phone drew: its page clock starts at the demo's first frame.
 *
 * @returns The frame.
 */
function lastFrame(): number {
  return fixtures.demoFrameAt(fixtures.DEMO_T0 + performance.now() - started);
}

/**
 * The value of a source now, from the fixtures; undefined for a source the manifest does not list.
 *
 * @param id - The source id.
 * @param input - The read's input.
 * @returns The value.
 */
function sourceValue(id: string, input: Json | undefined): Json | undefined {
  const last = lastFrame();
  switch (id) {
    case "editor.perf.second": {
      return toWireValue(fixtures.demoSecond(last));
    }
    case "editor.perf.frames": {
      return toWireValue(fixtures.demoFrames(afterOf(input), last));
    }
    case "editor.perf.events": {
      return toWireValue(fixtures.demoEvents(afterOf(input), last));
    }
    case "editor.perf.passes": {
      return toWireValue(fixtures.demoPasses(last));
    }
    case "editor.perf.detail": {
      const { from, to } = membersOf(input);
      return toWireValue(fixtures.demoDetail(Number(from), Number(to)));
    }
    case "editor.recorder": {
      return toWireValue(fixtures.demoRecorder());
    }
    case "game.render": {
      return fixtures.DEMO_RENDER;
    }
    case "game.assets": {
      return fixtures.DEMO_ASSETS;
    }
    case "game.effects": {
      return fixtures.DEMO_EFFECTS;
    }
    default: {
      return undefined;
    }
  }
}

/**
 * Sends a message when the socket is open.
 *
 * @param message - The message.
 */
function send(message: Message): void {
  if (socket?.readyState === WebSocket.OPEN) socket.send(encode(message));
}

/**
 * Answers a request for a source the manifest does not list, as the agent's bridge does.
 *
 * @param request - The request.
 * @param id - The source id.
 */
function unknownSource(request: RpcRequest, id: string): void {
  send(
    failure(request.id, {
      code: errorCode.unknownMethod,
      message: `[moku-editor] ${id}: unknown source`,
      data: { reason: "unknown_id", retryable: false, id }
    })
  );
}

/**
 * A watch: answered with null, then the value pushed (every second for the second and the passes).
 *
 * @param request - The watch request.
 */
function watch(request: RpcRequest): void {
  const { sub, id, input } = membersOf(request.params);
  if (typeof sub !== "number" || typeof id !== "string") return;
  const first = sourceValue(id, input);
  if (first === undefined) {
    unknownSource(request, id);
    return;
  }
  watches.get(sub)?.stop();
  send(success(request.id, null));
  const push = (value: Json | undefined): void => {
    if (value !== undefined) send(notification("game", "value", { sub, value }));
  };
  push(first);
  const timer = PUSHED_EVERY_SECOND.has(id)
    ? setInterval(() => push(sourceValue(id, input)), EVERY_MS)
    : undefined;
  watches.set(sub, { id, stop: () => clearInterval(timer) });
}

/**
 * Answers one request of the hub: manifest, read, watch, unwatch and run.
 *
 * @param request - The request.
 */
function answer(request: RpcRequest): void {
  const params = membersOf(request.params);
  switch (request.method) {
    case "manifest": {
      send(success(request.id, toWireValue(fixtures.demoManifest())));
      return;
    }
    case "read": {
      const id = String(params.id);
      const value = sourceValue(id, params.input);
      if (value === undefined) unknownSource(request, id);
      else send(success(request.id, value));
      return;
    }
    case "watch": {
      watch(request);
      return;
    }
    case "unwatch": {
      const sub = Number(params.sub);
      watches.get(sub)?.stop();
      watches.delete(sub);
      send(success(request.id, null));
      return;
    }
    case "run": {
      const state = { path: "garden/boss", frame: lastFrame(), tainted: false };
      send(success(request.id, { value: null, state }));
      return;
    }
    default: {
      send(
        failure(request.id, {
          code: errorCode.unknownMethod,
          message: `[moku-editor] ${request.channel}.${request.method}: unknown method`
        })
      );
    }
  }
}

/** The link step: hello with the demo manifest; the session notification starts the beat. */
function hello(): void {
  send(notification("game", "hello", { manifest: toWireValue(fixtures.demoManifest()) }));
}

/** Sends one heartbeat: the newest frame, running, now. */
function heartbeat(): void {
  send(notification("game", "heartbeat", { frame: lastFrame(), paused: false, at: Date.now() }));
}

/** Stops the beat and every watch's pushes. */
function quiet(): void {
  clearInterval(beat);
  beat = undefined;
  for (const entry of watches.values()) entry.stop();
  watches.clear();
}

/**
 * Takes one message of the hub.
 *
 * @param message - The decoded message.
 */
function onMessage(message: Message): void {
  if (isRequest(message)) {
    answer(message);
    return;
  }
  if (!("method" in message) || message.channel !== "editor") return;
  const params = membersOf(message.params);
  if (message.method === "paired") {
    credentials = { device: String(params.device), token: String(params.token) };
    say("paired", credentials.device);
    hello();
  } else if (message.method === "session") {
    say("session", String(params.id));
    clearInterval(beat);
    heartbeat();
    beat = setInterval(heartbeat, EVERY_MS);
  }
}

/** Dials the device listener: pairs without credentials, says hello with them. */
function dial(): void {
  const url = new URL(`ws://${options.address}/__editor/ws`);
  url.searchParams.set("kind", "agent");
  url.searchParams.set("role", "device");
  if (credentials !== undefined) {
    url.searchParams.set("device", credentials.device);
    url.searchParams.set("token", credentials.token);
  }
  const next: WebSocket = Reflect.construct(WebSocket, [url.href, { headers: { origin: ORIGIN } }]);
  socket = next;
  next.addEventListener("open", () => {
    say("open", credentials === undefined ? "pairing" : "rejoining");
    if (credentials === undefined) {
      const device = { model: "SM-A266B", os: "Android 15", engine: "0.15.1+9c41e0" };
      send(notification("editor", "pair", { code: PAIR_CODE, device }));
    } else hello();
  });
  next.addEventListener("message", event => {
    if (typeof event.data === "string") onMessage(decode(event.data));
  });
  next.addEventListener("close", event => {
    if (socket === next) socket = undefined;
    quiet();
    say("closed", String(event.code));
    // The hub does not know these credentials any more: the next dial pairs again.
    if (event.code === UNPAIRED) credentials = undefined;
    if (rejoin) {
      rejoin = false;
      dial();
    }
  });
}

/**
 * Closes the socket (the phone leaves).
 *
 * @param code - The close code.
 */
function leave(code = 1000): void {
  quiet();
  socket?.close(code);
}

process.on("SIGUSR1", () => {
  say("leaving");
  leave();
});
process.on("SIGUSR2", () => {
  say("rejoining");
  // A socket still closing dials again once it closed.
  if (socket === undefined) dial();
  else rejoin = true;
});
for (const signal of ["SIGTERM", "SIGINT"] as const) {
  process.on(signal, () => {
    leave();
    setTimeout(() => process.exit(0), 100);
  });
}

// Signal listeners alone do not keep the process alive: without this timer it would exit between
// a leave (SIGUSR1) and the rejoin (SIGUSR2).
setInterval(() => undefined, 60_000);

dial();
