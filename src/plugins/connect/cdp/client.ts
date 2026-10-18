/**
 * @file connect plugin — the CDP client of one WebView page (spec 11 C5.4–5). `send` accepts only
 * the read methods of the allowlist and refuses every other one before anything is written:
 * reading must not change the game or its timing (never `Runtime.evaluate`, `Runtime.enable`,
 * `Debugger.*`, `Page.*`, `Input.*`, `Network.*`, `HeapProfiler.*`). The socket is opened from Bun
 * with no Origin header (Chrome refuses a DevTools socket whose Origin it does not allow).
 */
import type { CdpClient, CdpOpen, CdpSocket } from "../types";

/** The CDP methods connect may send. */
export const CDP_ALLOWED = [
  "Runtime.getHeapUsage",
  "Performance.enable",
  "Performance.getMetrics",
  "Memory.getDOMCounters"
] as const;

/** The CDP methods added with `gcTrace` (exact GC events through Tracing). */
export const CDP_TRACE = ["Tracing.start", "Tracing.end"] as const;

/** How long one CDP call may wait for its answer, ms. */
const CALL_TIMEOUT_MS = 2000;

/** One call waiting for its answer. */
type Waiting = {
  readonly resolve: (result: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
};

/** Options of a CDP connection. */
export type CdpOptions = {
  /** Allow the Tracing methods too. */
  readonly gcTrace: boolean;
  /** How long the socket may take to open, ms. */
  readonly timeoutMs: number;
  /** Called once when the socket closes after it opened (by itself or by `close`). */
  readonly onClose: () => void;
};

/**
 * Whether connect may send a CDP method.
 *
 * @param method - The method.
 * @param gcTrace - Whether Tracing is allowed.
 * @returns True for an allowlisted method.
 * @example
 * ```ts
 * isCdpAllowed("Runtime.evaluate", true); // false
 * ```
 */
export function isCdpAllowed(method: string, gcTrace: boolean): boolean {
  const allowed: readonly string[] = gcTrace ? [...CDP_ALLOWED, ...CDP_TRACE] : CDP_ALLOWED;
  return allowed.includes(method);
}

/**
 * The refusal of a method outside the allowlist.
 *
 * @param method - The method.
 * @returns The two-line Error.
 * @example
 * ```ts
 * notAllowed("Runtime.evaluate").message; // "[moku-editor] connect: CDP method Runtime.evaluate is not allowed.\n  The editor reads the device only."
 * ```
 */
function notAllowed(method: string): Error {
  return new Error(
    `[moku-editor] connect: CDP method ${method} is not allowed.\n  The editor reads the device only.`
  );
}

/**
 * The error a closed socket answers.
 *
 * @returns The Error.
 * @example
 * ```ts
 * closedError().message; // "[moku-editor] connect: the CDP socket closed.\n  The next tick attaches again."
 * ```
 */
function closedError(): Error {
  return new Error(
    "[moku-editor] connect: the CDP socket closed.\n  The next tick attaches again."
  );
}

/**
 * Reads one CDP answer: `{ id, result }` or `{ id, error: { message } }`. Events (no id) and other
 * shapes give undefined.
 *
 * @param text - The frame.
 * @returns The id and the result or the error message.
 * @example
 * ```ts
 * answerOf('{"id":3,"result":{"usedSize":1}}'); // { id: 3, result: { usedSize: 1 } }
 * ```
 */
function answerOf(
  text: string
): { readonly id: number; readonly result?: unknown; readonly error?: string } | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || !("id" in parsed)) return undefined;
  const { id } = parsed;
  if (typeof id !== "number") return undefined;
  if (!("error" in parsed)) return { id, result: "result" in parsed ? parsed.result : undefined };
  const { error } = parsed;
  const message =
    typeof error === "object" && error !== null && "message" in error ? String(error.message) : "";
  return { id, error: message === "" ? "CDP error" : message };
}

/** Where a client stands: closed or not, the last request id, and whether Tracing is allowed. */
type ClientState = { closed: boolean; nextId: number; readonly gcTrace: boolean };

/**
 * The client over an open socket.
 *
 * @param socket - The socket.
 * @param waiting - The calls waiting for their answers.
 * @param state - Whether the socket closed, the last id, and gcTrace.
 * @returns The client.
 */
function clientOf(socket: CdpSocket, waiting: Map<number, Waiting>, state: ClientState): CdpClient {
  return {
    send: method => {
      if (!isCdpAllowed(method, state.gcTrace)) throw notAllowed(method);
      if (state.closed) return Promise.reject(closedError());
      state.nextId += 1;
      const id = state.nextId;
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          waiting.delete(id);
          reject(new Error(`[moku-editor] connect: CDP ${method} timed out.\n  The page is busy.`));
        }, CALL_TIMEOUT_MS);
        waiting.set(id, { resolve, reject, timer });
        socket.send(JSON.stringify({ id, method }));
      });
    },
    close: () => socket.close(),
    closed: () => state.closed
  };
}

/**
 * Opens a CDP connection to a page's debugger URL and resolves once the socket is open. A socket
 * that closes later rejects its waiting calls and calls `onClose` once.
 *
 * @param open - Opens the socket (Bun's WebSocket, no Origin header).
 * @param url - The page's `webSocketDebuggerUrl`.
 * @param options - gcTrace, the open timeout and the close callback.
 * @returns The client.
 * @throws {Error} When the socket closes or does not open within the timeout.
 */
export function connectCdp(open: CdpOpen, url: string, options: CdpOptions): Promise<CdpClient> {
  const waiting = new Map<number, Waiting>();
  const state: ClientState = { closed: false, nextId: 0, gcTrace: options.gcTrace };
  let socket: CdpSocket | undefined;
  const link: CdpSocket = {
    send: text => socket?.send(text),
    close: () => socket?.close()
  };
  let opened = false;

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      state.closed = true;
      link.close();
      reject(
        new Error(
          "[moku-editor] connect: the CDP socket did not open.\n  The next tick tries again."
        )
      );
    }, options.timeoutMs);
    const closed = (): void => {
      if (state.closed) return;
      state.closed = true;
      clearTimeout(timer);
      for (const call of waiting.values()) {
        clearTimeout(call.timer);
        call.reject(closedError());
      }
      waiting.clear();
      if (opened) options.onClose();
      else reject(closedError());
    };
    socket = open(url, {
      onOpen: () => {
        if (state.closed) return;
        clearTimeout(timer);
        opened = true;
        resolve(clientOf(link, waiting, state));
      },
      onMessage: text => {
        const answer = answerOf(text);
        const call = answer === undefined ? undefined : waiting.get(answer.id);
        if (answer === undefined || call === undefined) return;
        waiting.delete(answer.id);
        clearTimeout(call.timer);
        if (answer.error === undefined) call.resolve(answer.result);
        else call.reject(new Error(answer.error));
      },
      onClose: closed
    });
  });
}

/**
 * Opens a CDP socket with Bun's WebSocket client, which sends no Origin header.
 *
 * @param url - The debugger URL.
 * @param events - Where the socket's events go.
 * @returns The socket.
 */
export function openCdpSocket(url: string, events: Parameters<CdpOpen>[1]): CdpSocket {
  const socket = new WebSocket(url);
  socket.addEventListener("open", () => events.onOpen());
  socket.addEventListener("message", event => {
    if (typeof event.data === "string") events.onMessage(event.data);
  });
  socket.addEventListener("close", () => events.onClose());
  socket.addEventListener("error", () => events.onClose());
  return {
    send: text => socket.send(text),
    close: () => socket.close()
  };
}
