/**
 * @file The wire tap of the server stack (plan §2.3): wraps the hub's one websocket handler before
 * it reaches `Bun.serve` and records every decoded message in both directions, plus every socket
 * open and close. Each call goes straight on to the real hub: the tap observes, it changes nothing.
 */
import type { Json, Message, Notification, Request } from "../../../src/index";
import { decode, isNotification, isRequest } from "../../../src/index";
import type { Hub } from "../../../src/server";

/** The kind of a hub connection. */
export type ConnKind = "agent" | "tools";

/** One decoded message on the wire. `in` is client → hub, `out` is hub → client. */
export type TapEntry = {
  readonly dir: "in" | "out";
  readonly kind: ConnKind;
  readonly conn: number;
  readonly message: Message;
  /** `performance.now()` when the hub saw it. */
  readonly at: number;
};

/** One socket open or close. */
export type TapSocket = {
  readonly type: "open" | "close";
  readonly kind: ConnKind;
  readonly conn: number;
  /** The close code as the hub saw it (close only). */
  readonly code?: number;
  readonly at: number;
};

/** What the tap recorded, with the queries the scenarios use. */
export type Tap = {
  /** Every decoded message, both directions, in order. */
  readonly entries: TapEntry[];
  /** Every socket open and close, in order. */
  readonly sockets: TapSocket[];
  /** Client → hub requests of one kind and method (any channel unless given). */
  requests(kind: ConnKind, method: string, channel?: string): Request[];
  /** Client → hub notifications of one kind and method (any channel unless given). */
  notes(kind: ConnKind, method: string, channel?: string): Notification[];
  /** Hub → client requests and notifications of one kind and method, e.g. `sent("agent", "run")`. */
  sent(kind: ConnKind, method: string, channel?: string): (Request | Notification)[];
  /** Source ids of the open tools watches (watch minus unwatch by sub, minus closed sockets). */
  watchedIds(conn?: number): string[];
  /** Wraps the hub handler; the result goes to Bun.serve as `websocket`. */
  wrap(handler: Hub.HubWebSocketHandler): Hub.HubWebSocketHandler;
};

/** A decoded JSON object. */
type JsonObject = { readonly [key: string]: Json };

/**
 * The params of a message when they are an object, else undefined.
 *
 * @param message - A wire message.
 * @returns The params object.
 */
export function paramsOf(message: Message): JsonObject | undefined {
  if (!("params" in message)) return undefined;
  const { params } = message;
  return typeof params === "object" && params !== null && !Array.isArray(params)
    ? params
    : undefined;
}

/**
 * Decodes a frame, or undefined for binary or invalid text.
 *
 * @param frame - The frame text or bytes.
 * @returns The message.
 */
function decodeFrame(frame: string | Uint8Array): Message | undefined {
  if (typeof frame !== "string") return undefined;
  try {
    return decode(frame);
  } catch {
    return undefined;
  }
}

/**
 * True when a message has the method and, if given, the channel.
 *
 * @param message - A request or notification.
 * @param method - The method.
 * @param channel - The channel, or undefined for any.
 * @returns Whether it matches.
 */
function matches(message: Request | Notification, method: string, channel?: string): boolean {
  return message.method === method && (channel === undefined || message.channel === channel);
}

/**
 * Creates an empty tap.
 *
 * @returns The tap.
 */
export function createTap(): Tap {
  const entries: TapEntry[] = [];
  const sockets: TapSocket[] = [];

  const record = (dir: "in" | "out", data: Hub.HubSocketData, frame: string | Uint8Array) => {
    const message = decodeFrame(frame);
    if (message === undefined) return;
    entries.push({ dir, kind: data.kind, conn: data.conn, message, at: performance.now() });
  };

  const pick = (dir: "in" | "out", kind: ConnKind): Message[] =>
    entries.filter(entry => entry.dir === dir && entry.kind === kind).map(entry => entry.message);

  const tapSocket = (ws: Hub.HubSocket): Hub.HubSocket => ({
    data: ws.data,
    send: text => {
      record("out", ws.data, text);
      return ws.send(text);
    },
    close: (code, reason) => {
      ws.close(code, reason);
    }
  });

  return {
    entries,
    sockets,
    requests: (kind, method, channel) =>
      pick("in", kind)
        .filter(message => isRequest(message))
        .filter(message => matches(message, method, channel)),
    notes: (kind, method, channel) =>
      pick("in", kind)
        .filter(message => isNotification(message))
        .filter(message => matches(message, method, channel)),
    sent: (kind, method, channel) =>
      pick("out", kind)
        .filter(message => isRequest(message) || isNotification(message))
        .filter(message => matches(message, method, channel)),
    watchedIds: conn => openWatches(entries, sockets, conn),
    wrap: handler => ({
      ...handler,
      open: ws => {
        sockets.push({
          type: "open",
          kind: ws.data.kind,
          conn: ws.data.conn,
          at: performance.now()
        });
        handler.open(tapSocket(ws));
      },
      message: (ws, frame) => {
        record("in", ws.data, frame);
        handler.message(ws, frame);
      },
      close: (ws, code, reason) => {
        sockets.push({
          type: "close",
          kind: ws.data.kind,
          conn: ws.data.conn,
          code,
          at: performance.now()
        });
        handler.close(ws, code, reason);
      },
      drain: ws => {
        handler.drain(ws);
      }
    })
  };
}

/**
 * The source ids of the tools watches still open: every game-channel `watch` a tools socket sent,
 * minus its `unwatch` of the same sub, minus every watch of a socket that closed. Sorted; a source
 * watched twice shows twice.
 *
 * @param entries - The tap entries.
 * @param sockets - The socket opens and closes.
 * @param conn - One tools connection, or undefined for all.
 * @returns The source ids.
 */
function openWatches(
  entries: readonly TapEntry[],
  sockets: readonly TapSocket[],
  conn: number | undefined
): string[] {
  const open = new Map<string, string>();
  for (const entry of entries) {
    if (entry.dir !== "in" || entry.kind !== "tools") continue;
    if (conn !== undefined && entry.conn !== conn) continue;
    const { message } = entry;
    if (!("method" in message) || message.channel !== "game") continue;
    const params = paramsOf(message);
    const key = `${String(entry.conn)}:${String(params?.sub)}`;
    if (message.method === "watch" && typeof params?.id === "string") open.set(key, params.id);
    if (message.method === "unwatch") open.delete(key);
  }
  const closed = new Set(
    sockets.filter(socket => socket.type === "close").map(socket => `${String(socket.conn)}:`)
  );
  return [...open]
    .filter(([key]) => ![...closed].some(prefix => key.startsWith(prefix)))
    .map(([, id]) => id)
    .toSorted();
}
