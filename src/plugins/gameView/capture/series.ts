/**
 * @file gameView plugin — a series (D3, F10): one `editor.series` call through panels.run (R1,
 * R9), `editor.seriesStop` to end it early, then the numbered PNGs and index.json, the
 * `series:` line on the clipboard (round 2 R2), the series card (round 2b R14) and the contact
 * sheet with the in-memory images. A failed call writes nothing; a failed PNG write leaves a
 * partial index marked stoppedEarly.
 */
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import type { Json } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { copyQuietly } from "../clipboard";
import { GAME_COMMANDS, gameReady, NO_GAME_TEXT } from "../commands";
import { reportFailure } from "../report";
import { notify } from "../state";
import type { GameViewCtx, Recording, SeriesIndex, SeriesResult, SeriesShot } from "../types";
import { dayFolder, deviceLabel, plannedShots, seriesFolder, shotName, stamp } from "./naming";
import { currentPosition, deviceOf, isObject, listTaken, type ShotValue, showCard } from "./shot";

/**
 * One shot of an `editor.series` value.
 */
type SeriesValueShot = { readonly image: string; readonly frame: number; readonly atMs: number };

/**
 * The value of `editor.series` (R2).
 */
export type SeriesValue = {
  readonly shots: readonly SeriesValueShot[];
  readonly device: ShotValue["device"];
};

/**
 * Series options of the api and the popover.
 */
export type SeriesOptions = {
  readonly durationMs: number;
  readonly intervalMs: number;
  readonly label?: string;
};

/**
 * Reads one shot of a series value.
 *
 * @param value - A shot.
 * @returns The shot, or undefined.
 * @example
 * ```ts
 * seriesShotOf({ image: "data:image/png;base64,AA", frame: 1777, atMs: 0 })?.atMs; // 0
 * ```
 */
function seriesShotOf(value: Json): SeriesValueShot | undefined {
  if (!isObject(value)) return undefined;
  const { image, frame, atMs } = value;
  if (typeof image !== "string" || typeof frame !== "number" || typeof atMs !== "number") {
    return undefined;
  }
  return { image, frame, atMs };
}

/**
 * Reads an `editor.series` value.
 *
 * @param value - The run value.
 * @returns The shots and the device, or undefined for another shape.
 * @example
 * ```ts
 * seriesValueOf({ shots: [], device: { w: 393, h: 852, orientation: "portrait" } })?.shots; // []
 * ```
 */
export function seriesValueOf(value: Json): SeriesValue | undefined {
  if (!isObject(value) || !Array.isArray(value.shots)) return undefined;
  const device = deviceOf(value.device);
  const shots = value.shots.map(shot => seriesShotOf(shot));
  if (device === undefined || shots.includes(undefined)) return undefined;
  return { shots: shots.filter(shot => shot !== undefined), device };
}

/**
 * The text of an index.json: two-space JSON and a final newline.
 *
 * @param index - The index.
 * @returns The file text.
 * @example
 * ```ts
 * formatIndex({ label: "a", durationMs: 1, intervalMs: 1, fromFrame: 0, shots: [] }).endsWith("}\n"); // true
 * ```
 */
export function formatIndex(index: SeriesIndex): string {
  return `${JSON.stringify(index, undefined, 2)}\n`;
}

/**
 * Opens or closes the series popover (D3).
 *
 * @param ctx - Domain context of gameView.
 * @param open - The wanted state.
 * @returns True when the state changed.
 */
export function setPopover(ctx: Pick<GameViewCtx, "state">, open: boolean): boolean {
  const { series } = ctx.state;
  if (series.popover === open) return false;
  series.popover = open;
  notify(ctx.state);
  return true;
}

/** Toast when a series is asked for while another one records. */
const BUSY_TEXT = "A series is already recording.";

/** Label of a series when neither the caller nor the flow position names it. */
const DEFAULT_LABEL = "series";

/**
 * The shots written so far and the first write failure, if any.
 */
type WrittenShots = {
  readonly shots: SeriesShot[];
  readonly images: string[];
  readonly failure: unknown;
};

/**
 * Writes the PNGs in order and counts them on the recording; stops at the first failed write.
 *
 * @param ctx - Domain context of gameView.
 * @param recording - The recording.
 * @param value - The editor.series value.
 * @returns The written shots, their images and the failure.
 */
async function writeShots(
  ctx: GameViewCtx,
  recording: Recording,
  value: SeriesValue
): Promise<WrittenShots> {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const shots: SeriesShot[] = [];
  const images: string[] = [];
  for (const [index, shot] of value.shots.entries()) {
    const file = shotName(index, value.shots.length);
    try {
      await link.files.writeBinary(`${recording.folder}${file}`, shot.image);
    } catch (error) {
      return { shots, images, failure: error };
    }
    shots.push({ file, frame: shot.frame, atMs: shot.atMs, bug: false });
    images.push(shot.image);
    recording.written = shots.length;
    notify(state);
  }
  return { shots, images, failure: undefined };
}

/**
 * The index.json of a series. A series stopped by the user or by a failed write keeps its real
 * length and is marked stoppedEarly.
 *
 * @param ctx - Domain context of gameView.
 * @param recording - The recording.
 * @param value - The editor.series value.
 * @param written - The written shots.
 * @param elapsedMs - Tools-side length of the call.
 * @returns The index.
 */
function seriesIndex(
  ctx: GameViewCtx,
  recording: Recording,
  value: SeriesValue,
  written: WrittenShots,
  elapsedMs: number
): SeriesIndex {
  const { shots } = written;
  const stoppedEarly = recording.stopRequested || written.failure !== undefined;
  const index: SeriesIndex = {
    label: recording.label,
    durationMs: stoppedEarly ? elapsedMs : recording.durationMs,
    intervalMs: recording.intervalMs,
    fromFrame: shots[0]?.frame ?? 0,
    shots,
    device: { name: ctx.require(workspacePlugin).device().preset.name, ...value.device }
  };
  if (stoppedEarly) index.stoppedEarly = true;
  return index;
}

/**
 * Writes the shots in order, then index.json; puts `series: <folder> (<n> frames)` on the
 * clipboard and shows the series card when a shot was written; opens the contact sheet.
 *
 * @param ctx - Domain context of gameView.
 * @param recording - The recording.
 * @param value - The editor.series value.
 * @param elapsedMs - Tools-side length of the call.
 * @returns The written series.
 */
async function writeSeries(
  ctx: GameViewCtx,
  recording: Recording,
  value: SeriesValue,
  elapsedMs: number
): Promise<SeriesResult> {
  const { state } = ctx;
  const link = ctx.require(linkPlugin);
  const workspace = ctx.require(workspacePlugin);
  recording.phase = "writing";
  notify(state);

  // The PNGs first, then the index that lists the ones that made it.
  const written = await writeShots(ctx, recording, value);
  const index = seriesIndex(ctx, recording, value, written, elapsedMs);
  const indexPath = `${recording.folder}index.json`;
  let failure = written.failure;
  let version: string | undefined;
  try {
    const saved = await link.files.write(indexPath, formatIndex(index));
    version = saved.version;
  } catch (error) {
    failure ??= error;
  }

  // Tell the user what was saved.
  if (failure === undefined) {
    workspace.toast(`✓ ${written.shots.length} shots saved`, recording.folder);
  } else {
    reportFailure(ctx, "Series not fully saved", "gameView: series write failed", failure);
  }
  if (written.shots.length > 0) {
    await copyQuietly(ctx, `series: ${recording.folder} (${written.shots.length} frames)`);
  }

  // Swap the recording for the contact sheet.
  state.series.recording = undefined;
  state.series.popover = false;
  state.series.sheet = { indexPath, index, images: written.images, version, big: undefined };
  notify(state);

  // Show the first shot on the capture card.
  const [first] = written.images;
  if (first !== undefined) {
    showCard(ctx, {
      path: recording.folder,
      frame: index.fromFrame,
      device: deviceLabel(index.device?.name ?? "", value.device.orientation),
      image: first,
      series: { indexPath, shots: written.shots.length }
    });
  }
  return { folder: recording.folder, indexPath, shots: written.shots.length };
}

/**
 * Toasts and refuses when a series already records.
 *
 * @param ctx - Domain context of gameView.
 * @returns True when another series records.
 */
function refuseWhileRecording(ctx: GameViewCtx): boolean {
  if (ctx.state.series.recording === undefined) return false;
  ctx.require(workspacePlugin).toast(BUSY_TEXT);
  return true;
}

/**
 * Runs editor.series through panels and reads its value; on failure clears the recording and
 * toasts.
 *
 * @param ctx - Domain context of gameView.
 * @param options - Length and spacing.
 * @returns The value, undefined when the call failed.
 */
async function runSeries(
  ctx: GameViewCtx,
  options: SeriesOptions
): Promise<SeriesValue | undefined> {
  const { state } = ctx;
  const { durationMs, intervalMs } = options;
  try {
    const ran = await ctx
      .require(panelsPlugin)
      .run(GAME_COMMANDS.series, { durationMs, intervalMs });
    const value = seriesValueOf(ran.value);
    if (value === undefined) {
      throw new Error(
        "[moku-editor] editor.series returned no shots.\n  Update the game's capturePlugin."
      );
    }
    return value;
  } catch (error) {
    state.series.recording = undefined;
    notify(state);
    reportFailure(ctx, "Series failed", "gameView: series failed", error);
    return undefined;
  }
}

/**
 * Records a series with one editor.series call and writes it; refuses while another runs.
 *
 * @param ctx - Domain context of gameView.
 * @param options - Length, spacing and an optional label.
 * @returns The written series, undefined when refused or failed (toasted).
 */
export async function recordSeries(
  ctx: GameViewCtx,
  options: SeriesOptions
): Promise<SeriesResult | undefined> {
  const { state, config } = ctx;
  const workspace = ctx.require(workspacePlugin);
  if (refuseWhileRecording(ctx)) return undefined;
  if (!gameReady(ctx.require(linkPlugin), GAME_COMMANDS.series)) {
    workspace.toast(NO_GAME_TEXT);
    return undefined;
  }

  // Name the folder; another series may have started while the position and the list loaded.
  workspace.show("game");
  const now = new Date();
  const day = dayFolder(config.capturesDir, now);
  const position = await currentPosition(ctx);
  const taken = await listTaken(ctx, day);
  if (refuseWhileRecording(ctx)) return undefined;

  // Mark the series as recording, then run it and write what it answers.
  const { durationMs, intervalMs } = options;
  const recording: Recording = {
    folder: seriesFolder(day, stamp(now), taken),
    label: options.label ?? position.path ?? DEFAULT_LABEL,
    startedAt: performance.now(),
    durationMs,
    intervalMs,
    planned: plannedShots(durationMs, intervalMs),
    phase: "recording",
    written: 0,
    stopRequested: false
  };
  state.series.recording = recording;
  state.series.durationMs = durationMs;
  state.series.intervalMs = intervalMs;
  notify(state);

  const value = await runSeries(ctx, options);
  if (value === undefined) return undefined;
  return writeSeries(ctx, recording, value, Math.round(performance.now() - recording.startedAt));
}

/**
 * Ends the running series early: marks it stopped and runs editor.seriesStop through panels
 * (R2, R9). The pending editor.series call then resolves with the shots taken so far.
 *
 * @param ctx - Domain context of gameView.
 */
export function stopRecording(ctx: GameViewCtx): void {
  const { recording } = ctx.state.series;
  if (recording !== undefined) {
    recording.stopRequested = true;
    notify(ctx.state);
  }
  ctx
    .require(panelsPlugin)
    .run(GAME_COMMANDS.seriesStop)
    .catch((error: unknown) => {
      ctx.log.warn("gameView: series stop failed", { error });
    });
}
