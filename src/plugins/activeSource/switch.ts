/**
 * @file activeSource plugin — the source switch (spec 11 § 4 B4–B6, B8): to a device (pause the
 * local preview first, then link chooses the device), to the local preview (link chooses it, then
 * the pause activeSource made is undone), the loss of the active device, and the adoption of a
 * choice made elsewhere. Switches are serialized by a counter: a newer one supersedes an older one
 * at its next step. `game.pause` / `game.resume` run one at a time in a queue, so a pause and the
 * resume that undoes it never cross.
 */
/* eslint-disable unicorn/no-null -- the spec's local source of a page without a local preview */
import { linkPlugin } from "../link";
import { ERROR_PREFIX } from "../registry/protocol";
import { resetHealth, resetOffsets } from "./health";
import { callLease, syncRenew } from "./leases";
import { nameOf, sentence, sourceOf } from "./names";
import { addMarker, closeNotice, showNotice } from "./notice";
import type { ActiveSource, ActiveSourceCtx, ActiveSourceState, SourceChange } from "./types";

/**
 * Why a switch to a device happens: the person chose it, it linked (autoUse, connectDevice), or it
 * came back (the rejoin rule, Reconnect).
 */
export type DeviceReason = "user" | "connected" | "rejoined";

/**
 * Why the active device stopped being the source on its own: its session left, or device mode was
 * stopped.
 */
export type LossReason = "lost" | "stopped";

/**
 * The marker kind of each reason that leaves a marker (adopted leaves none).
 */
const MARKER_KIND = {
  connected: "connected",
  rejoined: "rejoined",
  user: "user",
  lost: "lost",
  stopped: "lost"
} as const;

/**
 * The message of an error a caller can read.
 *
 * @param error - Anything thrown.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("[moku-editor] link closed.")); // "[moku-editor] link closed."
 * ```
 */
export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Starts a switch: supersedes every older one and names its target.
 *
 * @param state - activeSource state.
 * @param target - The session it chooses (null: no local preview to choose).
 * @returns Its number.
 */
function begin(state: ActiveSourceState, target: string | null): number {
  state.switching += 1;
  state.target = target;
  return state.switching;
}

/**
 * True while a switch is the newest and the plugin runs.
 *
 * @param state - activeSource state.
 * @param switching - The switch's number.
 * @returns Whether it may go on.
 */
function isLatest(state: ActiveSourceState, switching: number): boolean {
  return state.switching === switching && !state.stopped;
}

/**
 * Queues a pause or resume step of the local preview after the ones already queued.
 *
 * @param state - activeSource state.
 * @param step - The step; it never rejects.
 * @returns When the step ran.
 */
function enqueue(state: ActiveSourceState, step: () => Promise<void>): Promise<void> {
  state.local = state.local.then(step);
  return state.local;
}

/**
 * The preview state when nothing holds the local preview: running while it has a session.
 *
 * @param ctx - Domain context of activeSource.
 * @returns The state.
 */
function idlePreview(ctx: ActiveSourceCtx): ActiveSourceState["preview"] {
  return { state: ctx.require(linkPlugin).ownSession() === undefined ? "none" : "running" };
}

/**
 * Pauses the local preview for a device source (B4 step 1). The hub's heartbeat readout of the own
 * session is the already-held check: paused → held, never resumed by this plugin. Else game.pause;
 * only a `true` answer makes the session the resume target. A refusal or failure leaves the preview
 * unpausable with the reason.
 *
 * @param ctx - Domain context of activeSource.
 * @param switching - The switch the step belongs to; a newer switch skips it.
 */
async function pauseOwn(ctx: ActiveSourceCtx, switching: number): Promise<void> {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const own = link.ownSession();
  if (!isLatest(state, switching) || own === undefined) return;
  if (state.preview.state === "paused-by-source" && state.pausedSession === own) return;

  const readout = link.sessions().find(session => session.id === own)?.heartbeat;
  if (readout?.paused === true) {
    state.preview = { state: "held" };
    state.pausedSession = undefined;
    return;
  }

  state.preview = { state: "pausing" };
  try {
    const answer = await link.runIn(own, "game.pause");
    if (answer.value === true) {
      state.preview = { state: "paused-by-source" };
      state.pausedSession = own;
    } else {
      state.preview = { state: "unpausable", reason: "game.pause answered that the game runs" };
    }
  } catch (error) {
    state.preview = { state: "unpausable", reason: messageOf(error) };
    ctx.log.warn("activeSource:pause-failed", { session: own, message: messageOf(error) });
  }
}

/**
 * Undoes the pause this plugin made (B5): game.resume on `pausedSession` when it is still open. A
 * held preview stays held.
 *
 * @param ctx - Domain context of activeSource.
 * @param switching - The switch the step belongs to; a newer switch skips it.
 */
async function resumeOwn(ctx: ActiveSourceCtx, switching: number): Promise<void> {
  const { state } = ctx;
  if (!isLatest(state, switching) || state.preview.state === "held") return;

  const link = ctx.require(linkPlugin);
  const paused = state.pausedSession;
  state.pausedSession = undefined;
  const open = paused !== undefined && link.sessions().some(session => session.id === paused);
  if (state.preview.state !== "paused-by-source" || !open) {
    state.preview = idlePreview(ctx);
    return;
  }

  state.preview = { state: "resuming" };
  try {
    await link.runIn(paused, "game.resume");
  } catch (error) {
    ctx.log.warn("activeSource:resume-failed", { session: paused, message: messageOf(error) });
  }
  state.preview = idlePreview(ctx);
}

/**
 * Calls the onChange listeners; a throwing one is logged and the others still run.
 *
 * @param ctx - Domain context of activeSource.
 * @param change - The change.
 */
function tellListeners(ctx: ActiveSourceCtx, change: SourceChange): void {
  for (const listener of ctx.state.listeners) {
    try {
      listener(change);
    } catch (error) {
      ctx.log.error("activeSource:listener-failed", {}, error instanceof Error ? error : undefined);
    }
  }
}

/**
 * Makes `to` the source (step 3 of B4/B5): the telemetry, health and clock of another device are
 * dropped, the watch lease moves, a device source ends the rejoin rule and the notice, the marker,
 * `activeSource:changed`, the onChange listeners.
 *
 * @param ctx - Domain context of activeSource.
 * @param to - The new source.
 * @param reason - Why.
 * @param label - The marker's label; none for no marker (adopted).
 */
function applyChange(
  ctx: ActiveSourceCtx,
  to: ActiveSource,
  reason: SourceChange["reason"],
  label?: string
): void {
  const { state } = ctx;
  const from = state.current;
  const fromDevice = from.kind === "device" ? from.device.id : undefined;
  const toDevice = to.kind === "device" ? to.device.id : undefined;
  state.current = to;

  if (fromDevice !== toDevice) {
    state.telemetry = undefined;
    resetHealth(state.health);
    resetOffsets(state.offsets);
    if (fromDevice !== undefined) callLease(ctx, "connect.unwatch", { device: fromDevice });
    if (toDevice !== undefined) callLease(ctx, "connect.watch", { device: toDevice });
  }
  if (toDevice !== undefined) {
    state.seen.add(toDevice);
    state.lost = undefined;
    closeNotice(state);
  }
  syncRenew(ctx);

  const at = Date.now();
  if (label !== undefined && reason !== "adopted") {
    const device = toDevice ?? fromDevice ?? null;
    addMarker(state, ctx.config, { at, kind: MARKER_KIND[reason], label, device });
  }
  const change: SourceChange = { from, to, reason, at };
  ctx.emit("activeSource:changed", change);
  tellListeners(ctx, change);
}

/**
 * The marker label of a switch to a device.
 *
 * @param reason - Why.
 * @param name - The device's name.
 * @returns The label.
 * @example
 * ```ts
 * deviceLabel("connected", "Galaxy A26"); // "Galaxy A26 connected"
 * ```
 */
function deviceLabel(reason: DeviceReason, name: string): string {
  if (reason === "user") return `Switched to ${name}`;
  return `${sentence(name)} ${reason === "connected" ? "connected" : "reconnected"}`;
}

/**
 * Makes a device session the source (B4): pause the local preview (pauseLocal), let link choose
 * the session, then the change. Choosing the current source does nothing. When link cannot attach
 * the device, the pause is undone while the local preview is still the source.
 *
 * @param ctx - Domain context of activeSource.
 * @param session - A session id of link.sessions() with a device.
 * @param reason - Why.
 * @returns When link attached the session (or a newer switch took over).
 * @throws {TypeError} For a session without a device (two-line message).
 * @throws {Error} link's -32003 `choose_session` for an id that is not open; link's attach errors.
 */
export async function switchToDevice(
  ctx: ActiveSourceCtx,
  session: string,
  reason: DeviceReason
): Promise<void> {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const entry = link.sessions().find(item => item.id === session);
  if (entry === undefined) {
    // Not open: link rejects with its own -32003, before anything is paused.
    await link.choose(session);
    return;
  }
  const { device } = entry;
  if (device === undefined) {
    throw new TypeError(
      `${ERROR_PREFIX}activeSource.useDevice needs a device session, got "${session}".\n  Pass an id from link.sessions() that has a device.`
    );
  }
  const { current } = state;
  if (current.kind === "device" && current.session === session && state.target === undefined) {
    return;
  }

  const switching = begin(state, session);
  try {
    if (ctx.config.pauseLocal) await enqueue(state, () => pauseOwn(ctx, switching));
    if (!isLatest(state, switching)) return;
    await link.choose(session);
  } catch (error) {
    if (isLatest(state, switching)) {
      state.target = undefined;
      if (state.current.kind !== "device") void enqueue(state, () => resumeOwn(ctx, switching));
    }
    throw error;
  }
  if (!isLatest(state, switching)) return;

  state.target = undefined;
  const name = nameOf(device, link.published("devices"));
  applyChange(ctx, { kind: "device", session, device }, reason, deviceLabel(reason, name));
}

/**
 * Makes the local preview the source (B5): link chooses it, the change, then the resume of what
 * this plugin paused. On a page without a local preview the source is `{ kind: "local", session:
 * null }`. In a loss, a choose that fails is logged and the source still turns local.
 *
 * @param ctx - Domain context of activeSource.
 * @param own - link.ownSession().
 * @param reason - Why.
 * @param label - The marker's label.
 * @returns When the resume step ran.
 * @throws {Error} link's choose error, for the person's own switch only.
 */
async function toLocal(
  ctx: ActiveSourceCtx,
  own: string | undefined,
  reason: "user" | LossReason,
  label: string
): Promise<void> {
  const { state } = ctx;
  const switching = begin(state, own ?? null);
  let session = own ?? null;

  if (own !== undefined) {
    try {
      await ctx.require(linkPlugin).choose(own);
    } catch (error) {
      if (isLatest(state, switching)) state.target = undefined;
      if (reason === "user") throw error;
      ctx.log.warn("activeSource:choose-failed", { session: own, message: messageOf(error) });
      session = null;
    }
  }
  if (!isLatest(state, switching)) return;

  state.target = undefined;
  applyChange(ctx, { kind: "local", session }, reason, label);
  await enqueue(state, () => resumeOwn(ctx, switching));
}

/**
 * The person's "Use local preview" (useLocal): ends the rejoin rule and the notice, then switches
 * to the local preview unless it is the source already.
 *
 * @param ctx - Domain context of activeSource.
 * @returns When link attached the local preview and the resume ran.
 * @throws {Error} The two-line "no local preview" error on a page without its own game frame.
 */
export async function switchToLocal(ctx: ActiveSourceCtx): Promise<void> {
  const { state } = ctx;
  const own = ctx.require(linkPlugin).ownSession();
  if (own === undefined) {
    throw new Error(
      `${ERROR_PREFIX}activeSource.useLocal: this page has no local preview.\n  Open the editor with a game (moku-editor <game>) to have one.`
    );
  }
  state.lost = undefined;
  closeNotice(state);

  const { current } = state;
  if (current.kind === "local" && current.session === own && state.target === undefined) return;
  await toLocal(ctx, own, "user", "Switched to the local preview");
}

/**
 * The active device stopped being the source on its own (B6): the rejoin rule starts, the notice
 * shows for noticeMs, and the page returns to the local preview with the loss marker.
 *
 * @param ctx - Domain context of activeSource.
 * @param reason - lost, or stopped (device mode turned off).
 */
export function loseSource(ctx: ActiveSourceCtx, reason: LossReason): void {
  const { state, config } = ctx;
  const { current } = state;
  if (current.kind !== "device") return;

  const link = ctx.require(linkPlugin);
  const { device } = current;
  const name = sentence(nameOf(device, link.published("devices")));
  const own = link.ownSession();
  const paused = state.pausedSession;
  const resumes =
    state.preview.state === "paused-by-source" &&
    link.sessions().some(session => session.id === paused);
  let tail = "Showing the local preview";
  if (own === undefined) tail = "No other source";
  else if (resumes) tail = "Local preview resumed";

  state.lost = { device: device.id, model: device.model, at: Date.now(), waiting: false };
  showNotice(state, config, {
    device: device.id,
    model: device.model,
    text: `${name} disconnected. ${own === undefined ? "No other source." : "Showing the local preview."}`,
    back: false
  });
  // A loss never rejects: a failed choose is logged inside and the source still turns local.
  void toLocal(ctx, own, reason, `${name} disconnected here · ${tail}`);
}

/**
 * Adopts a session link chose without this plugin (B2, B8), with reason adopted and no marker, and
 * applies the pause rule of its kind: a device pauses the local preview, anything else resumes it.
 *
 * @param ctx - Domain context of activeSource.
 * @param session - link's chosen session.
 */
export function adopt(ctx: ActiveSourceCtx, session: string): void {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const info = link.sessions().find(item => item.id === session);
  if (info === undefined) return;
  const to = sourceOf(info, link.ownSession());
  if (to.kind === state.current.kind && to.session === state.current.session) return;

  state.switching += 1;
  const switching = state.switching;
  applyChange(ctx, to, "adopted");
  if (to.kind !== "device") {
    void enqueue(state, () => resumeOwn(ctx, switching));
  } else if (ctx.config.pauseLocal) {
    void enqueue(state, () => pauseOwn(ctx, switching));
  }
}

/**
 * Pauses a new local preview session while a device is the source (B7): the local frame reloaded
 * (a save, hot reload) and its new session runs behind the device.
 *
 * @param ctx - Domain context of activeSource.
 */
export function pauseNewOwn(ctx: ActiveSourceCtx): void {
  const { state } = ctx;
  if (!ctx.config.pauseLocal) return;
  const switching = state.switching;
  void enqueue(state, () => pauseOwn(ctx, switching));
}
