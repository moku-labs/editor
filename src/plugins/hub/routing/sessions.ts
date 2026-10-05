/**
 * @file hub plugin — game sessions: the manifest check, open and close, the session choice of a
 * tools request, the SessionInfo list (R1 plus the heartbeat readout, M4) and the silent rule (R6:
 * 6 s, or 65 s after a paused heartbeat). A flip of paused or silent re-sends the list.
 */
import { randomBytes } from "node:crypto";
import type { Heartbeat, Json, Manifest, Notification, SessionInfo } from "../../registry/protocol";
import { errorCode, notification, toWireValue, wireError } from "../../registry/protocol";
import { JSON_NULL, sendJson, toolsConns } from "../sockets/send";
import type { AgentConn, HubCtx, HubSession, HubState, Session } from "../types";
import { failSession } from "./calls";
import { dropSession } from "./subscriptions";

/**
 * A paused game (a throttled background tab) counts as silent only after this long (R6).
 */
export const PAUSED_SILENT_AFTER_MS = 65_000;

/**
 * The longest `game` and `page` of a manifest.
 */
const MAX_TEXT = 2048;

/**
 * The most sources, and the most commands, a manifest may list.
 */
const MAX_ENTRIES = 1000;

/**
 * The longest source or command id.
 */
const MAX_ID = 128;

/**
 * Every input kind, optional or not.
 */
const INPUT_KINDS: ReadonlySet<string> = new Set(
  ["string", "number", "boolean", "json"].flatMap(kind => [kind, `${kind}?`])
);

/**
 * The `changes` of a source.
 */
const CHANGES: ReadonlySet<string> = new Set(["frame", "commit", "edge"]);

/**
 * The `effect` of a command.
 */
const EFFECTS: ReadonlySet<string> = new Set(["read", "route", "cosmetic", "cheat", "raw"]);

/**
 * The fields of a plain object, or undefined for anything else.
 *
 * @param value - Anything (decoded JSON).
 * @returns The own fields by name.
 * @example
 * ```ts
 * fieldsOf({ a: 1 })?.get("a"); // 1
 * ```
 */
function fieldsOf(value: unknown): ReadonlyMap<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? new Map(Object.entries(value))
    : undefined;
}

/**
 * True for a string of at most `max` characters.
 *
 * @param value - Anything.
 * @param max - The longest allowed length.
 * @returns Whether it is such a string.
 * @example
 * ```ts
 * isText("merge-game", 2048); // true
 * ```
 */
function isText(value: unknown, max: number): value is string {
  return typeof value === "string" && value.length <= max;
}

/**
 * True for an array of at most MAX_ENTRIES items that all pass a check.
 *
 * @param value - Anything.
 * @param check - The item check.
 * @returns Whether it is such a list.
 * @example
 * ```ts
 * isList([], isPanel); // true
 * ```
 */
function isList(value: unknown, check: (item: unknown) => boolean): boolean {
  return Array.isArray(value) && value.length <= MAX_ENTRIES && value.every(item => check(item));
}

/**
 * True for an input schema: an object whose values are input kinds.
 *
 * @param value - Anything.
 * @returns Whether it is an InputSchema.
 * @example
 * ```ts
 * isInputSchema({ frames: "number", deltaMs: "number?" }); // true
 * ```
 */
function isInputSchema(value: unknown): boolean {
  const fields = fieldsOf(value);
  return (
    fields !== undefined &&
    [...fields.values()].every(kind => typeof kind === "string" && INPUT_KINDS.has(kind))
  );
}

/**
 * True for a source or command descriptor: id (1–128 characters), title, input and a tag.
 *
 * @param value - Anything.
 * @param tag - "changes" for a source, "effect" for a command.
 * @param allowed - The allowed tag values.
 * @returns Whether it is such a descriptor.
 * @example
 * ```ts
 * isDescriptor({ id: "game.step", title: "Step", input: {}, effect: "cheat" }, "effect", EFFECTS); // true
 * ```
 */
function isDescriptor(value: unknown, tag: string, allowed: ReadonlySet<string>): boolean {
  const fields = fieldsOf(value);
  if (fields === undefined) return false;

  const id = fields.get("id");
  const kind = fields.get(tag);
  return (
    isText(id, MAX_ID) &&
    id !== "" &&
    typeof fields.get("title") === "string" &&
    isInputSchema(fields.get("input")) &&
    typeof kind === "string" &&
    allowed.has(kind)
  );
}

/**
 * True for a reserved panel entry `{ id, module }`.
 *
 * @param value - Anything.
 * @returns Whether it is a panel entry.
 * @example
 * ```ts
 * isPanel({ id: "p", module: "/p.js" }); // true
 * ```
 */
function isPanel(value: unknown): boolean {
  const fields = fieldsOf(value);
  return (
    fields !== undefined &&
    typeof fields.get("id") === "string" &&
    typeof fields.get("module") === "string"
  );
}

/**
 * True for the `restored` entry of a manifest: a string bookmark and a finite frame.
 *
 * @param value - Anything.
 * @returns Whether it is `{ bookmark, frame }`.
 * @example
 * ```ts
 * isRestored({ bookmark: '{"path":"home"}', frame: 1840 }); // true
 * isRestored({ bookmark: 1, frame: 1840 }); // false
 * ```
 */
function isRestored(value: unknown): boolean {
  const fields = fieldsOf(value);
  const frame = fields?.get("frame");
  return (
    typeof fields?.get("bookmark") === "string" &&
    typeof frame === "number" &&
    Number.isFinite(frame)
  );
}

/**
 * Checks the manifest of an agent's hello: game and page (≤ 2048 characters), embedded,
 * sources and commands (≤ 1000 each, ids ≤ 128), known input kinds, changes and effects,
 * panels absent or a list, and `restored` absent or `{ bookmark, frame }`.
 *
 * @param value - The decoded `manifest` member.
 * @returns Whether it is a Manifest.
 * @example
 * ```ts
 * isManifest({ game: "merge-game" }); // false: page, sources and commands are missing
 * ```
 */
export function isManifest(value: unknown): value is Manifest {
  const fields = fieldsOf(value);
  if (fields === undefined) return false;

  const panels = fields.get("panels");
  const restored = fields.get("restored");
  return (
    isText(fields.get("game"), MAX_TEXT) &&
    isText(fields.get("page"), MAX_TEXT) &&
    typeof fields.get("embedded") === "boolean" &&
    isList(fields.get("sources"), item => isDescriptor(item, "changes", CHANGES)) &&
    isList(fields.get("commands"), item => isDescriptor(item, "effect", EFFECTS)) &&
    (panels === undefined || isList(panels, isPanel)) &&
    (restored === undefined || isRestored(restored))
  );
}

/**
 * Reads the `heap` of a heartbeat: finite `usedMb` and `limitMb`.
 *
 * @param value - The `heap` member.
 * @returns A fresh heap, or undefined when absent or malformed.
 * @example
 * ```ts
 * readHeap({ usedMb: 12.8, limitMb: 4095.8 }); // { usedMb: 12.8, limitMb: 4095.8 }
 * readHeap({ usedMb: "12.8" }); // undefined
 * ```
 */
function readHeap(value: unknown): Heartbeat["heap"] {
  const fields = fieldsOf(value);
  const usedMb = fields?.get("usedMb");
  const limitMb = fields?.get("limitMb");

  return Number.isFinite(usedMb) &&
    Number.isFinite(limitMb) &&
    typeof usedMb === "number" &&
    typeof limitMb === "number"
    ? { usedMb, limitMb }
    : undefined;
}

/**
 * Reads a heartbeat: finite `frame` and `at`, boolean `paused`. A well-formed `heap` is kept; a
 * malformed one is dropped and the beat is still read.
 *
 * @param params - The notification params.
 * @returns A fresh Heartbeat, or undefined when malformed.
 * @example
 * ```ts
 * readHeartbeat({ frame: 12, paused: false, at: 5 }); // { frame: 12, paused: false, at: 5 }
 * readHeartbeat({ frame: 12, paused: false, at: 5, heap: { usedMb: "x" } }); // { frame: 12, paused: false, at: 5 }
 * ```
 */
export function readHeartbeat(params: Json | undefined): Heartbeat | undefined {
  const fields = fieldsOf(params);
  const frame = fields?.get("frame");
  const paused = fields?.get("paused");
  const at = fields?.get("at");
  const isBeat =
    Number.isFinite(frame) &&
    Number.isFinite(at) &&
    typeof frame === "number" &&
    typeof at === "number" &&
    typeof paused === "boolean";
  if (!isBeat) return undefined;

  const heap = readHeap(fields?.get("heap"));
  return heap === undefined ? { frame, paused, at } : { frame, paused, at, heap };
}

/**
 * Four random hex digits.
 *
 * @returns e.g. "7f3a".
 * @example
 * ```ts
 * randomHex(); // "7f3a"
 * ```
 */
function randomHex(): string {
  return randomBytes(2).toString("hex");
}

/**
 * A free session id: `s-` and four hex digits, drawn again on collision.
 *
 * @param taken - The open sessions.
 * @param nextHex - The hex source (random by default).
 * @returns The id.
 */
export function sessionIdFrom(
  taken: ReadonlyMap<string, unknown>,
  nextHex: () => string = randomHex
): string {
  let id = `s-${nextHex()}`;
  while (taken.has(id)) id = `s-${nextHex()}`;

  return id;
}

/**
 * Opens a session for an agent that sent a valid hello.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The agent connection.
 * @param manifest - Its manifest.
 * @returns The new session.
 */
export function openSession(ctx: HubCtx, conn: AgentConn, manifest: Manifest): Session {
  const now = Date.now();
  const session: Session = {
    id: sessionIdFrom(ctx.state.sessions),
    conn: conn.conn,
    manifest,
    connectedAt: now,
    heartbeat: JSON_NULL,
    lastBeatAt: now,
    silent: false,
    nextSub: 1
  };
  ctx.state.sessions.set(session.id, session);
  conn.session = session.id;

  return session;
}

/**
 * The params of the editor-channel `session` notification.
 *
 * @param payload - The hub:session payload.
 * @returns The Json params (reason only when set).
 * @example
 * ```ts
 * sessionParams({ id: "s-1", game: "g", open: true }); // { id: "s-1", game: "g", open: true }
 * ```
 */
export function sessionParams(payload: HubSession): Json {
  const { id, game, open, reason } = payload;
  return reason === undefined ? { id, game, open } : { id, game, open, reason };
}

/**
 * The editor-channel `sessions {list}` notification.
 *
 * @param state - Hub state.
 * @returns The notification.
 */
export function sessionsNotification(state: HubState): Notification {
  return notification("editor", "sessions", { list: toWireValue(sessionList(state)) });
}

/**
 * Sends `sessions {list}` to every tools connection.
 *
 * @param ctx - Domain context of the hub.
 */
export function broadcastSessions(ctx: HubCtx): void {
  const note = sessionsNotification(ctx.state);
  for (const conn of toolsConns(ctx.state)) sendJson(conn, note);
}

/**
 * Fires an emit that is not awaited. A throw, or a rejected promise the emit returns, goes to
 * `onFailure`, so a failing hook never breaks the caller.
 *
 * @param fire - Calls ctx.emit.
 * @param onFailure - Logs the failure.
 * @example
 * ```ts
 * emitLogged(() => Promise.reject(new Error("x")), console.error); // returns; logs "Error: x" later
 * ```
 */
function emitLogged(fire: () => unknown, onFailure: (error: unknown) => void): void {
  try {
    const emitted = fire();
    if (emitted instanceof Promise) emitted.catch(onFailure);
  } catch (error) {
    onFailure(error);
  }
}

/**
 * Announces a session change: emits `hub:session` (not awaited; a throw or a rejected promise of
 * the emit is logged), tells every tools connection `session {…}`, then `sessions {list}`.
 *
 * @param ctx - Domain context of the hub.
 * @param payload - The change.
 */
export function announce(ctx: HubCtx, payload: HubSession): void {
  emitLogged(
    () => ctx.emit("hub:session", payload),
    error => ctx.log.error("hub:emit-failed", { id: payload.id, error: String(error) })
  );

  const note = notification("editor", "session", sessionParams(payload));
  for (const conn of toolsConns(ctx.state)) sendJson(conn, note);
  broadcastSessions(ctx);
}

/**
 * Closes a session: fails its pending calls (-32001), drops its subscriptions, forgets it and
 * announces the close.
 *
 * @param ctx - Domain context of the hub.
 * @param id - Session id.
 * @param reason - "bye" after a bye notification, else "game_reloaded".
 */
export function closeSession(ctx: HubCtx, id: string, reason: "bye" | "game_reloaded"): void {
  const session = ctx.state.sessions.get(id);
  if (session === undefined) return;

  failSession(ctx, id);
  dropSession(ctx, session);
  ctx.state.sessions.delete(id);
  announce(ctx, { id, game: session.manifest.game, open: false, reason });
}

/**
 * Builds the -32003 error of a request that cannot pick a session.
 *
 * @param message - What is wrong.
 * @param reason - "no_session" or "choose_session".
 * @param id - The requested session id, if any.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw noSession("no game is connected", "no_session");
 * ```
 */
function noSession(message: string, reason: "no_session" | "choose_session", id?: string): Error {
  const data = id === undefined ? {} : { id };
  return wireError(errorCode.noSession, message, { reason, retryable: false, ...data });
}

/**
 * The session a game-channel request goes to: the requested one, else the only one, else the one
 * embedded session.
 *
 * @param ctx - Domain context of the hub.
 * @param requested - The request's `session`, if any.
 * @returns The session.
 * @throws {Error} -32003 `no_session` (unknown id or no game) or `choose_session` (ambiguous).
 */
export function chooseSession(ctx: HubCtx, requested: string | undefined): Session {
  const { sessions } = ctx.state;

  if (requested !== undefined) {
    const found = sessions.get(requested);
    if (found === undefined)
      throw noSession(`no game session ${requested}`, "no_session", requested);
    return found;
  }

  const open = [...sessions.values()];
  const [only] = open;
  if (only === undefined) throw noSession("no game is connected", "no_session");
  if (open.length === 1) return only;

  const embedded = open.filter(session => session.manifest.embedded);
  const [chosen] = embedded;
  if (chosen !== undefined && embedded.length === 1) return chosen;

  throw noSession("several games are connected; choose a session", "choose_session");
}

/**
 * The wire view of a session: the five R1 fields, plus the heartbeat readout (frame and paused of
 * the last beat, the silent flag) once the session has sent a heartbeat.
 *
 * @param session - The session.
 * @returns A fresh SessionInfo.
 */
export function toSessionInfo(session: Session): SessionInfo {
  const { game, page, embedded } = session.manifest;
  const info = { id: session.id, game, page, embedded, connectedAt: session.connectedAt };
  if (session.heartbeat === null) return info;

  const { frame, paused } = session.heartbeat;
  return { ...info, heartbeat: { frame, paused, silent: session.silent } };
}

/**
 * Every open session as SessionInfo, ordered by connectedAt.
 *
 * @param state - Hub state.
 * @returns A fresh list.
 */
export function sessionList(state: HubState): SessionInfo[] {
  return [...state.sessions.values()]
    .toSorted((left, right) => left.connectedAt - right.connectedAt)
    .map(session => toSessionInfo(session));
}

/**
 * Stores a heartbeat; a silent session comes back (logged). When paused flips against the last
 * beat, or the session comes back, every tools connection gets the sessions list again. The first
 * beat of a session and a new frame alone send nothing.
 *
 * @param ctx - Domain context of the hub.
 * @param session - The session.
 * @param heartbeat - The heartbeat.
 * @param now - Epoch ms of arrival.
 */
export function recordHeartbeat(
  ctx: HubCtx,
  session: Session,
  heartbeat: Heartbeat,
  now: number
): void {
  const previous = session.heartbeat;
  const pausedFlipped = previous !== null && previous.paused !== heartbeat.paused;
  const revived = session.silent;

  session.heartbeat = heartbeat;
  session.lastBeatAt = now;
  session.silent = false;
  if (revived) ctx.log.info("hub:session-alive", { id: session.id });

  if (pausedFlipped || revived) broadcastSessions(ctx);
}

/**
 * Marks sessions silent whose last heartbeat is older than the limit: silentAfterMs, or
 * PAUSED_SILENT_AFTER_MS after a paused heartbeat (R6). Logged once per flip; when any session
 * flipped, every tools connection gets the sessions list once.
 *
 * @param ctx - Domain context of the hub.
 * @param now - Epoch ms.
 */
export function tickSilent(ctx: HubCtx, now: number): void {
  let flipped = false;
  for (const session of ctx.state.sessions.values()) {
    const paused = session.heartbeat?.paused === true;
    const limit = paused ? PAUSED_SILENT_AFTER_MS : ctx.config.silentAfterMs;
    if (session.silent || now - session.lastBeatAt <= limit) continue;

    session.silent = true;
    flipped = true;
    ctx.log.info("hub:session-silent", { id: session.id, paused });
  }

  if (flipped) broadcastSessions(ctx);
}
