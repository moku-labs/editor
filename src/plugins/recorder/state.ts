/* eslint-disable unicorn/no-null -- null is "no log yet" in the status the Record tab reads */
/**
 * @file recorder plugin — the state (the queue allocated once, the memory store), and the reads
 * over it every domain file shares: the info of a log, the file list, the status and its event.
 */
import { createMemoryStore, messageOf, NDJSON } from "./store";
import type { LogStore } from "./store/types";
import type {
  LogFileInfo,
  RecorderCtx,
  RecorderState,
  RecorderStatus,
  RecorderStatusEvent,
  Session
} from "./types";

/** Slots of the line queue: four seconds of a busy 1000-lines-a-second stream. */
export const QUEUE_LINES = 4096;

/**
 * Creates the recorder's state: the queue ring of QUEUE_LINES empty slots, the memory store (the
 * store until onStart opens OPFS), empty lists, zeros, idle.
 *
 * @returns The state.
 */
export function createRecorderState(): RecorderState {
  const memory = createMemoryStore();
  return {
    monitor: undefined,
    unsubscribe: undefined,
    timer: undefined,
    queue: Array.from<undefined>({ length: QUEUE_LINES }),
    queueHead: 0,
    queueSize: 0,
    header: undefined,
    startup: undefined,
    display: undefined,
    session: undefined,
    last: undefined,
    phase: "idle",
    store: memory,
    memory,
    files: [],
    named: new Set(),
    marks: [],
    outbox: [],
    outboxOwner: [],
    outboxIndex: [],
    outboxHead: 0,
    outboxBytes: 0,
    sent: 0,
    dropped: 0,
    droppedTick: 0,
    dropping: false,
    autoStartWait: 0,
    exports: 0,
    emitted: undefined,
    watchers: new Set(),
    watchFailing: false,
    failures: 0,
    heads: new Map(),
    revokes: new Map(),
    finishing: new Map()
  };
}

/**
 * The info of the log being recorded.
 *
 * @param session - The current log.
 * @returns A fresh info, `current: true`.
 */
export function infoOf(session: Session): LogFileInfo {
  const { name, label, startedAt, lines, bytes, sent } = session;
  return { name, label, startedAt, lines, bytes, sent, current: true, storage: session.store.kind };
}

/**
 * The logs, oldest first, the current one with its numbers of now.
 *
 * @param state - The recorder's state.
 * @returns A fresh list.
 */
export function filesOf(state: RecorderState): LogFileInfo[] {
  const { session } = state;
  return state.files.map(file => (file.name === session?.name ? infoOf(session) : file));
}

/**
 * A log of the list by name.
 *
 * @param state - The recorder's state.
 * @param name - The log's name.
 * @returns Its info; undefined for an unknown name.
 */
export function findFile(state: RecorderState, name: string): LogFileInfo | undefined {
  return state.files.find(file => file.name === name);
}

/**
 * The store that holds a log: the recorder's store for an OPFS log, the memory store otherwise.
 *
 * @param state - The recorder's state.
 * @param info - The log.
 * @returns Its store.
 */
export function storeOf(state: RecorderState, info: LogFileInfo): LogStore {
  return info.storage === "opfs" ? state.store : state.memory;
}

/**
 * The payload of `recorder:status` now.
 *
 * @param state - The recorder's state.
 * @returns A fresh event.
 */
export function statusEventOf(state: RecorderState): RecorderStatusEvent {
  const log = state.session ?? state.last;
  return {
    state: state.phase,
    lines: log?.lines ?? 0,
    bytes: log?.bytes ?? 0,
    sent: state.sent,
    pending: state.outbox.length - state.outboxHead
  };
}

/**
 * The status of the log and the outbox.
 *
 * @param state - The recorder's state.
 * @returns A fresh status.
 */
export function statusOf(state: RecorderState): RecorderStatus {
  const { session } = state;
  const log = session ?? state.last;
  return {
    ...statusEventOf(state),
    monitor: state.monitor !== undefined,
    file: log?.name ?? null,
    label: log?.label ?? null,
    sinceMs: session === undefined ? 0 : Date.now() - session.startedAt,
    storage: (session?.store ?? state.store).kind,
    dropped: state.dropped,
    // Who started it arrives with build wave 1 (spec 05 Delta 2026-10-16 R2-R4); none is recorded yet.
    startedBy: null
  };
}

/**
 * Whether two status events carry the same state and numbers.
 *
 * @param a - One event, or none.
 * @param b - The other.
 * @returns Whether nothing changed.
 */
function sameStatus(a: RecorderStatusEvent | undefined, b: RecorderStatusEvent): boolean {
  return (
    a !== undefined &&
    a.state === b.state &&
    a.lines === b.lines &&
    a.bytes === b.bytes &&
    a.sent === b.sent &&
    a.pending === b.pending
  );
}

/**
 * Calls the watches of the `editor.recorder` source, each isolated: a throw is caught, so the
 * others and the caller go on; the first throw of a streak of failing rounds warns
 * `recorder:watcher-failed`, a round without one ends the streak.
 *
 * @param ctx - The recorder's state and log.
 */
function callWatchers(ctx: Pick<RecorderCtx, "state" | "log">): void {
  const { state } = ctx;
  let failed = false;
  for (const watcher of state.watchers) {
    try {
      watcher();
    } catch (error) {
      failed = true;
      if (!state.watchFailing) {
        ctx.log.warn("recorder:watcher-failed", { message: messageOf(error) });
      }
      state.watchFailing = true;
    }
  }
  if (!failed) state.watchFailing = false;
}

/**
 * Emits `recorder:status` and calls the watches of the `editor.recorder` source: always when
 * `force`, else only when a number or the state changed since the last emit.
 *
 * @param ctx - The recorder's state, emit and log.
 * @param force - Emit even when nothing changed (start, stop, share, remove).
 */
export function emitStatus(ctx: Pick<RecorderCtx, "state" | "emit" | "log">, force: boolean): void {
  const { state } = ctx;
  const event = statusEventOf(state);
  if (!force && sameStatus(state.emitted, event)) return;
  state.emitted = event;
  ctx.emit("recorder:status", event);
  callWatchers(ctx);
}

/**
 * A whole log as one Blob: its chunks in the store that holds it, after the chunks an earlier
 * store kept when the log moved to memory.
 *
 * @param state - The recorder's state.
 * @param info - The log.
 * @returns The Blob, of type application/x-ndjson.
 */
export async function readLog(state: RecorderState, info: LogFileInfo): Promise<Blob> {
  const rest = await storeOf(state, info).read(info.name);
  const head = state.heads.get(info.name);
  if (head === undefined) return rest;
  return new Blob([await head.read(info.name), rest], { type: NDJSON });
}

/**
 * Removes a log from the store that holds it and from the store that keeps its earlier chunks. The
 * memory store forgets it before the first await, so `memoryBytes` drops at once.
 *
 * @param state - The recorder's state.
 * @param info - The log.
 */
export async function dropLog(state: RecorderState, info: LogFileInfo): Promise<void> {
  const head = state.heads.get(info.name);
  state.heads.delete(info.name);
  await storeOf(state, info).remove(info.name);
  await head?.remove(info.name);
}
