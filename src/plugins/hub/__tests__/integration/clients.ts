import { connect } from "node:net";
import type { Json, Manifest, Message, Request as RpcRequest } from "../../../registry/protocol";
import { decode, encode, isRequest, notification, toWireValue } from "../../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Real websocket clients for the hub integration tests: a fake agent (game
// page) and a tools page, both Bun WebSocket clients with an Origin header,
// plus raw HTTP helpers for the upgrade refusals.
// ─────────────────────────────────────────────────────────────────────────────

/** Anything with Bun's server stop. */
type Stoppable = { stop(force?: boolean): Promise<void> };

/**
 * Closes clients and a server without hanging: waits (bounded) for every close handshake, then
 * stops the server (bounded too: Bun's stop(true) does not resolve while a close is in flight).
 *
 * @param clients - Clients to close.
 * @param stopApp - Stops the editor app (closes the server side with 1001).
 * @param server - The Bun server.
 */
export async function shutdown(
  clients: readonly Client[],
  stopApp: () => Promise<void>,
  server: Stoppable
): Promise<void> {
  for (const client of clients) client.close();
  await Promise.all(clients.map(client => Promise.race([client.closed, Bun.sleep(500)])));
  await stopApp().catch(() => undefined);
  await Promise.race([server.stop(true), Bun.sleep(300)]);
}

/** A small manifest the fake agent announces. */
export const AGENT_MANIFEST: Manifest = {
  game: "merge-game 0.0.0",
  page: "http://127.0.0.1/",
  embedded: true,
  sources: [
    { id: "game.position", title: "Position", input: {}, changes: "commit" },
    { id: "game.history", title: "History", input: { last: "number?" }, changes: "edge" }
  ],
  commands: [{ id: "game.step", title: "Step", input: { frames: "number" }, effect: "cheat" }]
};

/** How a socket closed. */
export type Closed = { readonly code: number; readonly reason: string };

/** A connected websocket client that records every message. */
export type Client = {
  readonly socket: WebSocket;
  readonly messages: Message[];
  /** Resolves with the first recorded message that matches (now or later). */
  next(match: (message: Message) => boolean, timeoutMs?: number): Promise<Message>;
  /** Sends a message, or raw text / bytes. */
  send(message: Message | string | Uint8Array): void;
  /** Resolves when the socket closes. */
  readonly closed: Promise<Closed>;
  close(): void;
};

/** Options of a client connection. */
export type ClientOptions = {
  readonly token: string;
  readonly kind: "agent" | "tools";
  /** The `role` query, e.g. "page" for the editor page; absent by default. */
  readonly role?: string;
  readonly origin?: string;
  readonly path?: string;
};

/**
 * Opens a Bun WebSocket with headers (Bun's client option).
 *
 * @param url - Socket URL.
 * @param headers - Request headers.
 * @returns The socket.
 */
function openSocket(url: string, headers: Record<string, string>): WebSocket {
  const socket: WebSocket = Reflect.construct(WebSocket, [url, { headers }]);
  return socket;
}

/**
 * The first message that matches.
 *
 * @param messages - Recorded messages.
 * @param match - The matcher.
 * @returns The message, or undefined.
 */
function firstMatch(
  messages: readonly Message[],
  match: (message: Message) => boolean
): Message | undefined {
  for (const message of messages) if (match(message)) return message;
  return undefined;
}

/**
 * Connects a client and waits for the socket to open.
 *
 * @param port - Server port.
 * @param options - Token, kind, role, origin and path.
 * @returns The open client.
 */
export async function connectClient(port: number, options: ClientOptions): Promise<Client> {
  const path = options.path ?? "/__editor";
  const role = options.role === undefined ? "" : `&role=${options.role}`;
  const url = `ws://127.0.0.1:${port}${path}/ws?token=${options.token}&kind=${options.kind}${role}`;
  const socket = openSocket(url, { origin: options.origin ?? `http://127.0.0.1:${port}` });
  const messages: Message[] = [];
  const waiters = new Set<() => void>();

  socket.addEventListener("message", event => {
    if (typeof event.data === "string") messages.push(decode(event.data));
    for (const waiter of waiters) waiter();
  });
  const closed = new Promise<Closed>(resolve => {
    socket.addEventListener("close", event => resolve({ code: event.code, reason: event.reason }));
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("socket did not open")));
  });

  const client: Client = {
    socket,
    messages,
    closed,
    next(match, timeoutMs = 2000) {
      return new Promise((resolve, reject) => {
        const check = (): void => {
          const found = firstMatch(messages, match);
          if (found === undefined) return;
          waiters.delete(check);
          clearTimeout(timer);
          resolve(found);
        };
        const timer = setTimeout(() => {
          waiters.delete(check);
          reject(new Error("no matching message"));
        }, timeoutMs);
        waiters.add(check);
        check();
      });
    },
    send(message) {
      if (typeof message === "string") socket.send(message);
      else if (message instanceof Uint8Array) socket.send(Uint8Array.from(message));
      else socket.send(encode(message));
    },
    close() {
      socket.close();
    }
  };
  return client;
}

/**
 * Connects a fake agent and sends its hello; resolves with the session id the hub announces.
 *
 * @param port - Server port.
 * @param token - Hub token.
 * @param manifest - Manifest to announce.
 * @returns The agent client and its session id.
 */
export async function connectAgent(
  port: number,
  token: string,
  manifest: Manifest = AGENT_MANIFEST
): Promise<{ agent: Client; session: string }> {
  const agent = await connectClient(port, { token, kind: "agent" });
  agent.send(notification("game", "hello", { manifest: toWireValue(manifest) }));
  const note = await agent.next(isNote("editor", "session"));
  const id = paramsOf(note)?.id;
  if (typeof id !== "string") throw new Error("no session id");
  return { agent, session: id };
}

/**
 * Matches a notification of a channel and method.
 *
 * @param channel - Channel.
 * @param method - Method.
 * @returns The matcher.
 */
export function isNote(channel: string, method: string): (message: Message) => boolean {
  return message =>
    "method" in message &&
    !("id" in message) &&
    message.channel === channel &&
    message.method === method;
}

/**
 * Matches the response to a request id.
 *
 * @param id - Request id.
 * @returns The matcher.
 */
export function isResponseTo(id: number): (message: Message) => boolean {
  return message => !("method" in message) && message.id === id;
}

/**
 * Matches a request of a method.
 *
 * @param method - Method.
 * @returns The matcher.
 */
export function isRequestOf(method: string): (message: Message) => message is RpcRequest {
  return (message): message is RpcRequest =>
    "method" in message && "id" in message && message.method === method;
}

/**
 * The params of a message as an object.
 *
 * @param message - A message.
 * @returns Its params object, or undefined.
 */
export function paramsOf(message: Message | undefined): { [key: string]: Json } | undefined {
  if (message === undefined || !("params" in message)) return undefined;
  const { params } = message;
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? params
    : undefined;
}

/** Headers of an upgrade attempt over plain HTTP. */
export type UpgradeAsk = {
  readonly token?: string | undefined;
  readonly kind?: string | undefined;
  readonly role?: string;
  readonly origin?: string | undefined;
  readonly host?: string | undefined;
  readonly upgrade?: string | undefined;
  readonly path?: string;
};

/**
 * Tries an upgrade with fetch and returns the status (101 when accepted).
 *
 * @param port - Server port.
 * @param ask - What to send; every key present overrides the default, undefined removes it.
 * @returns The HTTP status.
 */
export async function upgradeStatus(port: number, ask: UpgradeAsk): Promise<number> {
  const url = new URL(`http://127.0.0.1:${port}${ask.path ?? "/__editor/ws"}`);
  if (ask.token !== undefined) url.searchParams.set("token", ask.token);
  const kind = "kind" in ask ? ask.kind : "tools";
  if (kind !== undefined) url.searchParams.set("kind", kind);
  if (ask.role !== undefined) url.searchParams.set("role", ask.role);

  const defaults: Record<string, string | undefined> = {
    origin: `http://127.0.0.1:${port}`,
    host: `127.0.0.1:${port}`,
    upgrade: "websocket"
  };
  const headers: Record<string, string> = {
    connection: "Upgrade",
    "sec-websocket-key": "dGhlIHNhbXBsZSBub25jZQ==",
    "sec-websocket-version": "13"
  };
  for (const key of ["origin", "host", "upgrade"] as const) {
    const value = key in ask ? ask[key] : defaults[key];
    if (value !== undefined) headers[key] = value;
  }
  if (headers.upgrade === undefined) delete headers.connection;

  const response = await fetch(url, { headers });
  await response.body?.cancel();
  return response.status;
}

/**
 * Sends raw HTTP text over TCP and returns the status code of the answer.
 *
 * @param port - Server port.
 * @param text - The raw request.
 * @returns The status code, or 0 when the server closed without one.
 */
export function rawStatus(port: number, text: string): Promise<number> {
  return new Promise(resolve => {
    let received = "";
    const socket = connect(port, "127.0.0.1", () => socket.write(text));
    const done = (): void => {
      socket.destroy();
      const match = /^HTTP\/1\.[01] (\d{3})/.exec(received);
      resolve(match === null ? 0 : Number(match[1]));
    };
    socket.on("data", chunk => {
      received += chunk.toString();
      if (received.includes("\r\n")) done();
    });
    socket.on("close", done);
    socket.on("error", done);
  });
}

/**
 * Waits for the next request of a method a client received.
 *
 * @param client - The client (a fake agent).
 * @param method - The method.
 * @returns The request.
 */
export async function nextRequest(client: Client, method: string): Promise<RpcRequest> {
  const message = await client.next(isRequestOf(method));
  if (!isRequest(message)) throw new Error("not a request");
  return message;
}
