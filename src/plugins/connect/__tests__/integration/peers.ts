import type { Json, Message } from "../../../registry/protocol";
import { decode, encode, fromWireError, notification, request } from "../../../registry/protocol";

// ─────────────────────────────────────────────────────────────────────────────
// Real WebSocket peers of the connect integration test: a tools client that
// calls editor methods and records notifications, and a phone (role=device)
// that pairs and opens its game session.
// ─────────────────────────────────────────────────────────────────────────────

/** A notification a peer received. */
export type Note = {
  readonly channel: string;
  readonly method: string;
  readonly params: Json | undefined;
};

/** A connected peer. */
export type Peer = {
  /** Resolves with the first notification (now or later) that matches. */
  next(match: (note: Note) => boolean, timeoutMs?: number): Promise<Note>;
  /** Calls an editor method and resolves with its result; a wire error rejects. */
  call(method: string, params?: Json): Promise<Json>;
  /** Sends a message. */
  send(message: Message): void;
  close(): void;
};

/**
 * Resolves with the newest notification that matches, now or when one arrives.
 *
 * @param notes - The notifications so far (it grows).
 * @param waiters - Checks run on every message.
 * @param match - The matcher.
 * @param timeoutMs - The longest wait.
 * @returns The notification.
 */
function waitFor(
  notes: readonly Note[],
  waiters: Set<() => void>,
  match: (note: Note) => boolean,
  timeoutMs: number
): Promise<Note> {
  return new Promise((resolve, reject) => {
    const check = (): void => {
      const found = notes.findLast(note => match(note));
      if (found === undefined) return;
      waiters.delete(check);
      clearTimeout(timer);
      resolve(found);
    };
    const timer = setTimeout(() => {
      waiters.delete(check);
      reject(new Error("no matching notification"));
    }, timeoutMs);
    waiters.add(check);
    check();
  });
}

/**
 * Opens a peer with an Origin header and waits for the socket to open.
 *
 * @param url - The socket URL.
 * @param origin - The Origin header.
 * @returns The peer.
 */
export async function openPeer(url: string, origin: string): Promise<Peer> {
  const socket: WebSocket = Reflect.construct(WebSocket, [url, { headers: { origin } }]);
  const notes: Note[] = [];
  const waiters = new Set<() => void>();
  const answers = new Map<number, (message: Message) => void>();
  let nextId = 0;

  socket.addEventListener("message", event => {
    if (typeof event.data !== "string") return;
    const message = decode(event.data);
    if ("method" in message && !("id" in message)) {
      notes.push({ channel: message.channel, method: message.method, params: message.params });
    } else if (!("method" in message)) {
      answers.get(message.id)?.(message);
    }
    for (const waiter of waiters) waiter();
  });
  await new Promise<void>((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error(`socket ${url} did not open`)));
  });

  return {
    next: (match, timeoutMs = 4000) => waitFor(notes, waiters, match, timeoutMs),
    call(method, params) {
      nextId += 1;
      const id = nextId;
      return new Promise((resolve, reject) => {
        answers.set(id, message => {
          answers.delete(id);
          if ("error" in message) reject(fromWireError(message.error));
          else if ("result" in message) resolve(message.result);
        });
        socket.send(encode(request(id, "editor", method, params)));
      });
    },
    send(message) {
      socket.send(encode(message));
    },
    close() {
      socket.close();
    }
  };
}

/**
 * A phone that pairs over a device listener and says hello: the device id the hub issued.
 *
 * @param address - The listener's host:port.
 * @param device - The code it shows and its model.
 * @param device.code - The 4-digit code.
 * @param device.model - The model.
 * @param page - The page its game reports.
 * @returns The phone and its device id, once its session is open.
 */
export async function pairPhone(
  address: string,
  device: { readonly code: string; readonly model: string },
  page: string
): Promise<{ phone: Peer; device: string }> {
  const phone = await openPeer(
    `ws://${address}/__editor/ws?kind=agent&role=device`,
    "tauri://localhost"
  );
  phone.send(
    notification("editor", "pair", {
      code: device.code,
      device: { model: device.model, os: "Android 15", engine: "0.15.0+9c41e0", build: "debug-1" }
    })
  );
  const paired = await phone.next(note => note.method === "paired", 8000);
  const params = paired.params;
  const id =
    typeof params === "object" && params !== null && !Array.isArray(params)
      ? params.device
      : undefined;
  if (typeof id !== "string") throw new Error("no device id");

  const manifest = { game: "garden 0.0.0", page, embedded: false, sources: [], commands: [] };
  phone.send(notification("game", "hello", { manifest }));
  await phone.next(note => note.method === "session");
  phone.send(notification("game", "heartbeat", { frame: 1, paused: false, at: 5 }));
  return { phone, device: id };
}
