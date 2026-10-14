/**
 * @file renderView device strip — the data path (spec 09 R2, R3): whether the chosen session has
 * a strip (its manifest lists `editor.perf.second`) and whether it is a device session
 * (`SessionInfo.device`); the device watches (`editor.perf.second`, `.window`, `.spikes`,
 * `editor.recorder`, each only when listed available) while Render is shown, dropped in one
 * burst when it hides; the on-demand record read `editor.perf.spike { frame }` shared while it
 * loads, a late answer dropped; and the strip's api actions (step, select, close, More).
 */

import type { SessionDevice } from "../../hub/protocol";
import { linkPlugin } from "../../link";
import type { LinkApi } from "../../link/types";
import type { Json, Manifest } from "../../registry/protocol";
import { bareMessage, toWireError } from "../../registry/protocol";
import { notify } from "../state";
import type { RenderViewCtx, RenderViewState } from "../types";
import { readWireWindow } from "./contract";
import { stripView } from "./derive";
import { isPerfSecond, isRecorderStatus, isSpikeList, isSpikeRecord } from "./guards";
import { clearStripData } from "./state";
import { stepFrom } from "./step";
import type { DeviceStripView } from "./types";

/**
 * The source whose presence in the manifest gives a session its strip.
 */
export const PERF_SECOND = "editor.perf.second";

/**
 * The window source; its availability is the strip's `perf`.
 */
const PERF_WINDOW = "editor.perf.window";

/**
 * The record source, read on demand.
 */
const PERF_SPIKE = "editor.perf.spike";

/**
 * The record reads in flight, per state: an open of the same frame shares its promise.
 */
const pending = new WeakMap<RenderViewState, Promise<void>>();

/**
 * True when the manifest lists a source available (`available !== false`).
 *
 * @param manifest - The manifest of the chosen session.
 * @param id - The source id.
 * @returns Whether it can be watched.
 */
function isListed(manifest: Manifest | undefined, id: string): boolean {
  const source = manifest?.sources.find(entry => entry.id === id);
  return source !== undefined && source.available !== false;
}

/**
 * True when the manifest lists `editor.perf.second`: the session has a strip.
 *
 * @param manifest - The manifest of the chosen session.
 * @returns Whether the strip shows.
 */
export function hasPerf(manifest: Manifest | undefined): boolean {
  return manifest?.sources.some(source => source.id === PERF_SECOND) ?? false;
}

/**
 * The device of the chosen session: present on a device session (a phone), undefined on a
 * browser session or without a session.
 *
 * @param link - The link api.
 * @returns The device.
 */
export function sessionDevice(link: LinkApi): SessionDevice | undefined {
  const id = link.session();
  return id === undefined ? undefined : link.sessions().find(session => session.id === id)?.device;
}

/**
 * Drops every device watch at once (Render hidden, another session, stop). The strip's data is
 * kept. Teardown-safe: it needs the state only.
 *
 * @param state - renderView state.
 */
export function stopDeviceWatches(state: RenderViewState): void {
  const stops = state.device.watches;
  state.device.watches = [];
  for (const stop of stops) stop();
}

/**
 * Forgets the strip: drops its watches and its data, and the session it belonged to (no game, or
 * a session without perf).
 *
 * @param state - renderView state.
 */
export function clearDevice(state: RenderViewState): void {
  stopDeviceWatches(state);
  clearStripData(state.device);
  state.device.session = undefined;
}

/**
 * Takes one value of a device source: dropped when its watches stopped meanwhile, refused when its
 * shape is wrong (warned); else stored, the strip marked dirty and the UI notified.
 *
 * @param ctx - Domain context of renderView.
 * @param id - The source id.
 * @param watches - The watch list of this start: a value after it was replaced is late.
 * @param store - Stores the value; returns false for a value of the wrong shape.
 * @returns The watch callback.
 */
function onValue(
  ctx: RenderViewCtx,
  id: string,
  watches: readonly (() => void)[],
  store: (value: Json) => boolean
): (value: Json) => void {
  return value => {
    const strip = ctx.state.device;
    if (strip.watches !== watches) return;
    if (!store(value)) {
      ctx.log.warn("renderView: unexpected source shape", { id });
      return;
    }
    strip.dirty = true;
    notify(ctx.state);
  };
}

/**
 * Starts the device watches once: the three perf sources and the recorder, each only when the
 * manifest lists it available.
 *
 * @param ctx - Domain context of renderView.
 * @param link - The link api.
 * @param manifest - The manifest of the chosen session.
 */
function startDeviceWatches(ctx: RenderViewCtx, link: LinkApi, manifest: Manifest): void {
  const strip = ctx.state.device;
  if (strip.watches.length > 0) return;

  const sources: readonly [string, (value: Json) => boolean][] = [
    [
      PERF_SECOND,
      value => {
        if (!isPerfSecond(value)) return false;
        strip.second = value;
        strip.secondAt = Date.now();
        return true;
      }
    ],
    [PERF_WINDOW, value => readWireWindow(value, strip.window)],
    [
      "editor.perf.spikes",
      value => {
        if (!isSpikeList(value)) return false;
        strip.spikes = value;
        return true;
      }
    ],
    [
      "editor.recorder",
      value => {
        if (!isRecorderStatus(value)) return false;
        strip.recorder = value;
        return true;
      }
    ]
  ];
  // Mark the watches started first: a value delivered at once by the watch is then kept.
  const stops: (() => void)[] = [];
  strip.watches = stops;
  for (const [id, store] of sources) {
    if (isListed(manifest, id))
      stops.push(link.watch(id, undefined, onValue(ctx, id, stops, store)));
  }
}

/**
 * Follows the chosen session (the manifest listener, `workspace:changed`, `link:status`): a
 * session whose manifest lists `editor.perf.second` gets the strip (a new session id starts it
 * empty), its watches run while Render is shown; any other session has no strip and sends no
 * `editor.perf.*` watch.
 *
 * @param ctx - Domain context of renderView.
 * @param link - The link api.
 * @param manifest - The manifest of the chosen session; undefined (session lost) keeps everything.
 */
export function syncDevice(
  ctx: RenderViewCtx,
  link: LinkApi,
  manifest: Manifest | undefined
): void {
  if (manifest === undefined) return;
  const { state } = ctx;
  const id = link.session();
  if (id === undefined || !hasPerf(manifest)) {
    if (state.device.session !== undefined) {
      clearDevice(state);
      notify(state);
    }
    return;
  }

  // A new session starts the strip empty; the same session keeps its data.
  const strip = state.device;
  if (strip.session?.id !== id) {
    stopDeviceWatches(state);
    clearStripData(strip);
  }
  strip.session = { id, device: sessionDevice(link) };
  strip.perf = isListed(manifest, PERF_WINDOW) ? "listed" : "absent";
  if (state.active) startDeviceWatches(ctx, link, manifest);
  else stopDeviceWatches(state);
  notify(state);
}

/**
 * The strip as it shows now: undefined while the chosen session has none.
 *
 * @param ctx - Domain context of renderView.
 * @returns The view.
 */
export function deviceView(ctx: RenderViewCtx): DeviceStripView | undefined {
  return stripView(ctx.state.device, Date.now(), ctx.require(linkPlugin).engine());
}

/**
 * Reads the record of a frame once; the answer is dropped when the record was closed or another
 * frame opened since.
 *
 * @param ctx - Domain context of renderView.
 * @param frame - The spike frame.
 * @returns Resolves when the read settled; never rejects.
 */
async function readRecord(ctx: RenderViewCtx, frame: number): Promise<void> {
  const strip = ctx.state.device;
  let answer: Json;
  try {
    answer = await ctx.require(linkPlugin).read(PERF_SPIKE, { frame });
  } catch (error) {
    if (strip.reading !== frame) return;
    strip.reading = undefined;
    strip.record = { kind: "failed", frame, message: bareMessage(toWireError(error).message) };
    notify(ctx.state);
    return;
  }
  if (strip.reading !== frame) return;

  strip.reading = undefined;
  if (answer === null) strip.record = { kind: "gone", frame };
  else if (isSpikeRecord(answer)) strip.record = { kind: "shown", frame, record: answer };
  else strip.record = { kind: "failed", frame, message: `${PERF_SPIKE}: unexpected shape` };
  notify(ctx.state);
}

/**
 * Selects a frame and opens its record: one read of `editor.perf.spike { frame }`, shared by an
 * open of the same frame while it loads. Without a strip nothing happens.
 *
 * @param ctx - Domain context of renderView.
 * @param frame - The spike frame.
 * @returns Resolves when the read settled.
 */
export function openSpike(ctx: RenderViewCtx, frame: number): Promise<void> {
  const { state } = ctx;
  const strip = state.device;
  if (strip.session === undefined) return Promise.resolve();

  const shared = pending.get(state);
  if (strip.reading === frame && shared !== undefined) return shared;

  strip.selected = frame;
  strip.record = { kind: "loading", frame };
  strip.reading = frame;
  strip.dirty = true;
  notify(state);
  const read = readRecord(ctx, frame).finally(() => {
    if (pending.get(state) === read) pending.delete(state);
  });
  pending.set(state, read);
  return read;
}

/**
 * Selects a frame without opening its record (a click on a plain bar): the readout box moves.
 *
 * @param ctx - Domain context of renderView.
 * @param frame - The frame.
 */
export function selectFrame(ctx: RenderViewCtx, frame: number): void {
  ctx.state.device.selected = frame;
  ctx.state.device.dirty = true;
  notify(ctx.state);
}

/**
 * Steps to the next or previous spike, wrapping, and opens its record.
 *
 * @param ctx - Domain context of renderView.
 * @param dir - 1 for next, −1 for previous.
 * @returns The frame now selected; undefined without a strip or a spike.
 */
export function stepToSpike(ctx: RenderViewCtx, dir: 1 | -1): number | undefined {
  const strip = ctx.state.device;
  if (strip.session === undefined) return undefined;
  const frame = stepFrom(strip.window, strip.selected, dir);
  if (frame === undefined) return undefined;
  void openSpike(ctx, frame);
  return frame;
}

/**
 * Closes the record panel: the selection stays, a late answer is dropped.
 *
 * @param ctx - Domain context of renderView.
 */
export function closeSpike(ctx: RenderViewCtx): void {
  const strip = ctx.state.device;
  strip.record = { kind: "closed" };
  strip.reading = undefined;
  notify(ctx.state);
}

/**
 * Opens or closes More.
 *
 * @param ctx - Domain context of renderView.
 * @param open - True to show the secondary counters.
 */
export function setMore(ctx: RenderViewCtx, open: boolean): void {
  ctx.state.device.more = open;
  notify(ctx.state);
}
