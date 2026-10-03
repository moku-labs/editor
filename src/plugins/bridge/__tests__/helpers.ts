/* eslint-disable unicorn/no-null -- null is the JSON value the wire carries */
import type { Mock } from "vitest";
import { vi } from "vitest";
import type { AgentEvents } from "../../../config";
import type {
  Heartbeat,
  Json,
  Manifest,
  Message,
  RunResult,
  SourceDescriptor
} from "../../registry/protocol";
import { decode, encode, request, wireError } from "../../registry/protocol";
import type { SourceEntry } from "../../registry/types";
import { createBridgeState } from "../state";
import type { BridgeConfig, BridgeDeps, BridgeNet, HelloResponse, SocketLike } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared fakes of the bridge unit tests: a log mock, a FakeSocket, a fake net,
// a fake registry (one source per change kind), a fake channel whose heartbeat
// listeners the test ticks, and deps over a fresh state.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A full Log.LogApi made of mocks.
 *
 * @returns The mock log.
 */
export function createLog() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    trace: vi.fn(() => []),
    expect: vi.fn(),
    addSink: vi.fn(),
    reset: vi.fn(),
    clearSinks: vi.fn()
  };
}

/** The mock log type. */
export type LogMock = ReturnType<typeof createLog>;

/** The event types a socket emits. */
type SocketEventType = "open" | "message" | "close" | "error";

/** Any socket event the fake delivers (every field present, so each listener type accepts it). */
type AnyEvent = { readonly data: unknown; readonly code: number; readonly reason: string };

/** A websocket fake: records sent texts and closes, lets the test emit events. */
export class FakeSocket implements SocketLike {
  readyState = 0;
  bufferedAmount = 0;
  readonly sent: string[] = [];
  readonly closes: { code: number | undefined; reason: string | undefined }[] = [];
  /** Called after each send (lets a test raise bufferedAmount). */
  onSend: ((text: string) => void) | undefined;
  private readonly listeners = new Map<SocketEventType, ((event: AnyEvent) => void)[]>();

  send(text: string): void {
    this.sent.push(text);
    this.onSend?.(text);
  }

  close(code?: number, reason?: string): void {
    this.closes.push({ code, reason });
    this.readyState = 3;
  }

  addEventListener(type: SocketEventType, fn: (event: AnyEvent) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(fn);
    this.listeners.set(type, list);
  }

  emit(type: SocketEventType, event: Partial<AnyEvent> = {}): void {
    const full: AnyEvent = { data: undefined, code: 1005, reason: "", ...event };
    for (const fn of this.listeners.get(type) ?? []) fn(full);
  }

  /** Marks the socket open and emits `open`. */
  open(): void {
    this.readyState = 1;
    this.emit("open");
  }

  /** Every sent message, decoded. */
  messages(): Message[] {
    return this.sent.map(text => decode(text));
  }

  /** Clears the recorded texts. */
  clear(): void {
    this.sent.length = 0;
  }
}

/** The body the fake hub answers by default. */
const HELLO_BODY = { ws: "/__editor/ws", token: "t1" };

/** Does nothing. */
const noop = (): void => {};

/** A watch stop that does nothing. */
const noWatch = (): (() => void) => noop;

/** A hello answer: ok with a body. */
export function helloOk(body: unknown = HELLO_BODY): HelloResponse {
  return { ok: true, status: 200, json: async () => body };
}

/** A hello answer with an HTTP error status. */
export function helloStatus(status: number): HelloResponse {
  return { ok: false, status, json: async () => ({}) };
}

/** What the fake fetch answers next: a response, a network error, or a promise the test holds. */
export type HelloAnswer = HelloResponse | Error | Promise<HelloResponse>;

/** A fake net: queued hello answers, recorded fetches and sockets. */
export type FakeNet = BridgeNet & {
  readonly fetches: { url: string; init: Parameters<BridgeNet["fetch"]>[1] }[];
  readonly sockets: { url: string; origin: string | undefined; socket: FakeSocket }[];
  readonly answers: HelloAnswer[];
  /** When set, openSocket throws it. */
  socketError: Error | undefined;
};

/**
 * Builds a fake net; an empty answer queue answers `helloOk()`.
 *
 * @returns The fake.
 */
export function fakeNet(): FakeNet {
  const net: FakeNet = {
    fetches: [],
    sockets: [],
    answers: [],
    socketError: undefined,
    fetch: async (url, init) => {
      net.fetches.push({ url, init });
      const answer = net.answers.shift() ?? helloOk();
      if (answer instanceof Error) throw answer;
      return answer;
    },
    openSocket: (url, origin) => {
      if (net.socketError !== undefined) throw net.socketError;
      const socket = new FakeSocket();
      net.sockets.push({ url, origin, socket });
      return socket;
    },
    random: () => 0.5
  };
  return net;
}

/** The descriptors of the fake registry: one source per change kind. */
export const SOURCES: readonly SourceDescriptor[] = [
  { id: "game.position", title: "Position", input: {}, changes: "edge" },
  { id: "game.model", title: "Model", input: {}, changes: "commit" },
  { id: "game.render", title: "Render", input: {}, changes: "frame" },
  { id: "game.broken", title: "Broken", input: {}, changes: "edge" }
];

/** The manifest of the fake registry. */
export const MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1:3000/game.html",
  embedded: false,
  sources: SOURCES,
  commands: [{ id: "game.step", title: "Step", input: { frames: "number" }, effect: "cosmetic" }]
};

/** A fake registry slice: manifest and source descriptors. */
export type FakeRegistry = BridgeDeps["registry"];

/**
 * Builds the fake registry.
 *
 * @returns The fake.
 */
export function fakeRegistry(): FakeRegistry {
  return {
    manifest: () => MANIFEST,
    source: (id: string): SourceEntry | undefined => {
      const descriptor = SOURCES.find(source => source.id === id);
      if (descriptor === undefined) return undefined;
      return { descriptor, read: () => null, watch: noWatch };
    }
  };
}

/** A run the test settles by hand. */
export type Deferred<T> = {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

/**
 * A promise with its settle functions.
 *
 * @returns The deferred.
 */
export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = noop;
  let reject: (error: unknown) => void = noop;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/** The run result of the fake channel. */
export const RAN: RunResult = {
  value: { frame: 2 },
  state: { path: "board/awaitIntent", frame: 2, tainted: false }
};

/** A fake channel: settable values, recorded watches, ticked heartbeats. */
export type FakeChannel = BridgeDeps["channel"] & {
  /** Values per source id. */
  readonly values: Map<string, Json>;
  /** Read errors per source id. */
  readonly readErrors: Map<string, Error>;
  /** Open watches: source id → onValue. */
  readonly watchers: Map<string, (value: Json) => void>;
  /** How many watch stops ran. */
  stops: number;
  /** Raw (id, input) of every read. */
  readonly reads: { id: string; input: Json | undefined }[];
  /** A read of these ids waits for the promise first. */
  readonly holds: Map<string, Promise<void>>;
  /** Run answers per command id; missing → RAN. */
  readonly runs: Map<string, () => Promise<RunResult>>;
  /** The beat heartbeat() returns. */
  beat: Heartbeat;
  /** The onHeartbeat listeners. */
  readonly listeners: Set<(beat: Heartbeat) => void>;
  /** Calls every heartbeat listener with `beat`. */
  tick(): void;
};

/**
 * Builds the fake channel.
 *
 * @returns The fake.
 */
export function fakeChannel(): FakeChannel {
  const channel: FakeChannel = {
    values: new Map<string, Json>([
      ["game.position", { path: "home" }],
      ["game.model", { coins: 1 }],
      ["game.render", { fps: 60 }]
    ]),
    readErrors: new Map(),
    watchers: new Map(),
    stops: 0,
    reads: [],
    holds: new Map(),
    runs: new Map(),
    beat: { frame: 12, paused: false, at: 1000 },
    listeners: new Set(),
    read: async (id, input) => {
      channel.reads.push({ id, input });
      await channel.holds.get(id);
      const error = channel.readErrors.get(id);
      if (error !== undefined) throw error;
      const value = channel.values.get(id);
      if (value === undefined) {
        throw wireError(-32_601, `${id}: unknown source`, { reason: "unknown_id", id });
      }
      return value;
    },
    watch: (id, _input, onValue) => {
      if (id === "game.broken") throw wireError(-32_602, "game.broken: bad input");
      channel.watchers.set(id, onValue);
      onValue(channel.values.get(id) ?? null);
      return () => {
        channel.stops += 1;
        channel.watchers.delete(id);
      };
    },
    run: (id, _input) => {
      const answer = channel.runs.get(id);
      return answer === undefined ? Promise.resolve(RAN) : answer();
    },
    heartbeat: () => channel.beat,
    onHeartbeat: fn => {
      channel.listeners.add(fn);
      return () => {
        channel.listeners.delete(fn);
      };
    },
    tick: () => {
      for (const fn of channel.listeners) fn(channel.beat);
    }
  };
  return channel;
}

/** Deps whose parts are the fakes. */
export type TestDeps = BridgeDeps & {
  readonly log: LogMock;
  readonly emit: Mock<(payload: AgentEvents["bridge:status"]) => void>;
  readonly net: FakeNet;
  readonly channel: FakeChannel;
};

/** The default config of the tests. */
export const CONFIG: BridgeConfig = {
  hello: "/__editor/hello",
  retryMs: 1000,
  callTimeoutMs: 5000
};

/**
 * Bridge deps over a fresh state and the fakes. The page is a browser page by default.
 *
 * @param overrides - Config and page overrides.
 * @param overrides.config - Config fields.
 * @param overrides.page - The page probe.
 * @returns The deps.
 */
export function createDeps(
  overrides: { config?: Partial<BridgeConfig>; page?: BridgeDeps["page"] } = {}
): TestDeps {
  const config = { ...CONFIG, ...overrides.config };
  return {
    config,
    state: createBridgeState({ config }),
    log: createLog(),
    emit: vi.fn<(payload: AgentEvents["bridge:status"]) => void>(),
    registry: fakeRegistry(),
    channel: fakeChannel(),
    net: fakeNet(),
    page: overrides.page ?? { href: "http://127.0.0.1:3000/game.html", document: new EventTarget() }
  };
}

/**
 * Deps with an open FakeSocket in place (phase "open").
 *
 * @returns The deps and the socket.
 */
export function openDeps(): { deps: TestDeps; socket: FakeSocket } {
  const deps = createDeps();
  const socket = new FakeSocket();
  socket.readyState = 1;
  deps.state.socket = socket;
  deps.state.phase = "open";
  return { deps, socket };
}

/**
 * Encodes a game-channel request.
 *
 * @param id - Request id.
 * @param method - Method name.
 * @param params - Params.
 * @param channel - Logical channel.
 * @returns The JSON text.
 */
export function requestText(
  id: number,
  method: string,
  params?: Json,
  channel: "game" | "files" | "editor" = "game"
): string {
  return encode(request(id, channel, method, params));
}

/**
 * Lets pending promise callbacks run (a few microtask turns).
 */
export async function flush(): Promise<void> {
  for (let turn = 0; turn < 10; turn += 1) await Promise.resolve();
}
