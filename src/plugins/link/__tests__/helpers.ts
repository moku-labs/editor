import type { Mock } from "vitest";
import { vi } from "vitest";
import type {
  Channel,
  Json,
  Manifest,
  Message,
  Request as RpcRequest,
  SessionInfo,
  ToolsBoot,
  WireError
} from "../../registry/protocol";
import {
  decode,
  encode,
  failure,
  isRequest,
  notification,
  success,
  toWireValue
} from "../../registry/protocol";
import { openSocket } from "../socket/connect";
import { createLinkState } from "../state";
import type { Config, LinkCtx } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Shared test helpers of link: a log mock, a domain ctx, a fake WebSocket the
// tests drive by hand, and wire fixtures (boot, sessions, manifest).
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

/** A link ctx whose emit and log are mocks. */
export type TestCtx = Omit<LinkCtx, "emit" | "log"> & {
  readonly emit: Mock<LinkCtx["emit"]>;
  readonly log: LogMock;
};

/** The boot JSON the tests inject. */
export const BOOT: ToolsBoot = {
  v: 1,
  ws: "ws://127.0.0.1:3000/__editor/ws",
  token: "secret-token-1",
  path: "/__editor",
  title: "moku editor",
  editorUrl: "vscode://file/{path}:{line}",
  root: "/work/game",
  gameUrl: "/"
};

/**
 * A link domain ctx with a real state and mock emit and log.
 *
 * @param config - Config overrides.
 * @returns The ctx.
 */
export function createCtx(config: Partial<Config> = {}): TestCtx {
  const resolved: Config = { retryMs: 1000, boot: "#moku-editor-boot", ...config };

  return {
    config: resolved,
    state: createLinkState({ config: resolved }),
    emit: vi.fn<LinkCtx["emit"]>(),
    log: createLog()
  };
}

/**
 * One game session.
 *
 * @param id - Session id.
 * @param overrides - Field overrides.
 * @returns The session.
 */
export function sessionOf(id: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    id,
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: false,
    connectedAt: 1000,
    ...overrides
  };
}

/**
 * A manifest with the given source ids and one command.
 *
 * @param sources - Source ids.
 * @returns The manifest.
 */
export function manifestOf(
  sources: readonly string[] = ["game.position", "game.history"]
): Manifest {
  return {
    game: "merge-game 0.0.0",
    page: "http://127.0.0.1:3000/",
    embedded: false,
    sources: sources.map(id => ({ id, title: id, input: {}, changes: "commit" })),
    commands: [{ id: "game.step", title: "Step", input: { frames: "number" }, effect: "raw" }]
  };
}

/** What a fake socket listener receives. */
type FakeEvent = { readonly data?: unknown; readonly code?: number; readonly reason?: string };

/**
 * A WebSocket double: records what link sends; the test fires open, message, close and error.
 */
export class FakeWebSocket {
  /** Every socket constructed since the last reset. */
  static readonly instances: FakeWebSocket[] = [];

  readonly url: string;
  /** Constructor arguments after the URL. */
  readonly extra: unknown[];
  /** Decoded messages link sent. */
  readonly sent: Message[] = [];
  closedWith: { code: number | undefined; reason: string | undefined } | undefined;
  readonly #listeners = new Map<string, ((event: FakeEvent) => void)[]>();

  constructor(url: string, ...extra: unknown[]) {
    this.url = url;
    this.extra = extra;
    FakeWebSocket.instances.push(this);
  }

  addEventListener(type: string, fn: (event: FakeEvent) => void): void {
    const list = this.#listeners.get(type) ?? [];
    list.push(fn);
    this.#listeners.set(type, list);
  }

  send(text: string): void {
    this.sent.push(decode(text));
  }

  close(code?: number, reason?: string): void {
    this.closedWith = { code, reason };
  }

  /** Fires `open`. */
  open(): void {
    this.#fire("open", {});
  }

  /** Fires `message` with an encoded wire message. */
  receive(message: Message): void {
    this.#fire("message", { data: encode(message) });
  }

  /** Fires `message` with raw data. */
  receiveRaw(data: unknown): void {
    this.#fire("message", { data });
  }

  /** Fires `close`. */
  drop(code = 1006, reason = ""): void {
    this.#fire("close", { code, reason });
  }

  /** Fires `error`. */
  fail(): void {
    this.#fire("error", {});
  }

  /** Sends a notification to link. */
  notify(channel: Channel, method: string, params?: Json, session?: string): void {
    this.receive(notification(channel, method, params, session));
  }

  /** Requests link sent, optionally of one method. */
  requests(method?: string): RpcRequest[] {
    return this.sent
      .filter(message => isRequest(message))
      .filter(message => method === undefined || message.method === method);
  }

  /** The last request of a method; throws when there is none. */
  last(method: string): RpcRequest {
    const found = this.requests(method).at(-1);
    if (found === undefined) throw new Error(`no ${method} request`);
    return found;
  }

  /** Answers a request with a result. */
  answer(request: RpcRequest, result: Json): void {
    this.receive(success(request.id, result));
  }

  /** Answers a request with an error. */
  reject(request: RpcRequest, error: WireError): void {
    this.receive(failure(request.id, error));
  }

  #fire(type: string, event: FakeEvent): void {
    for (const fn of this.#listeners.get(type) ?? []) fn(event);
  }
}

/**
 * The socket constructed last.
 *
 * @returns The fake socket.
 */
export function latestSocket(): FakeWebSocket {
  const socket = FakeWebSocket.instances.at(-1);
  if (socket === undefined) throw new Error("no socket was opened");
  return socket;
}

/**
 * Lets pending promise callbacks run (no timers involved).
 */
export async function flush(): Promise<void> {
  for (let index = 0; index < 10; index += 1) await Promise.resolve();
}

/**
 * Sends a `sessions` notification.
 *
 * @param socket - The fake socket.
 * @param list - The sessions.
 */
export function sendSessions(socket: FakeWebSocket, list: readonly SessionInfo[]): void {
  socket.notify("editor", "sessions", { list: toWireValue(list) });
}

/**
 * Opens a socket for the ctx (boot set), fires open, sends the sessions and answers the manifest.
 *
 * @param ctx - The test ctx.
 * @param list - Sessions the hub announces.
 * @param manifest - Manifest answered for the picked session.
 * @returns The open fake socket.
 */
export async function connected(
  ctx: TestCtx,
  list: readonly SessionInfo[] = [sessionOf("s-1")],
  manifest: Manifest = manifestOf()
): Promise<FakeWebSocket> {
  ctx.state.boot = BOOT;
  openSocket(ctx);
  const socket = latestSocket();
  socket.open();
  sendSessions(socket, list);
  if (list.length > 0) socket.answer(socket.last("manifest"), toWireValue(manifest));
  await flush();
  return socket;
}

/**
 * Sends a heartbeat of a session.
 *
 * @param socket - The fake socket.
 * @param session - Session id.
 * @param frame - Frame number.
 * @param paused - Paused flag.
 */
export function beat(socket: FakeWebSocket, session: string, frame: number, paused = false): void {
  socket.notify("game", "heartbeat", { frame, paused, at: Date.now() }, session);
}

/**
 * Installs the boot tag in the current document.
 *
 * @param boot - The JSON text or object to put in the tag.
 */
export function installBoot(boot: ToolsBoot | string = BOOT): void {
  const text = typeof boot === "string" ? boot : JSON.stringify(boot);
  document.body.innerHTML = `<script type="application/json" id="moku-editor-boot">${text}</script>`;
}
