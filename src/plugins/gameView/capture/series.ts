/**
 * @file gameView plugin — a series (D3, F10): one `editor.series` call through panels.run (R1,
 * R9), `editor.seriesStop` to end it early, then the numbered PNGs and index.json, and the contact
 * sheet with the in-memory images. A failed call writes nothing; a failed PNG write leaves a
 * partial index marked stoppedEarly.
 */
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import type { Json } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { GAME_COMMANDS, gameReady, NO_GAME_TEXT } from "../commands";
import { reportFailure } from "../report";
import { notify } from "../state";
import type { GameViewCtx, Recording, SeriesIndex, SeriesResult, SeriesShot } from "../types";
import { plannedShots, seriesFolder, shotName, stamp } from "./naming";
import { currentPosition, deviceOf, isObject, listTaken, type ShotValue } from "./shot";

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
 * @example
 * ```ts
 * workspace.keys.escape("seriesPopover", () => setPopover(ctx, false));
 * ```
 */
export function setPopover(ctx: Pick<GameViewCtx, "state">, open: boolean): boolean {
  const { series } = ctx.state;
  if (series.popover === open) return false;
  series.popover = open;
  notify(ctx.state);
  return true;
}

/**
 * Writes the shots in order, then index.json; opens the contact sheet.
 *
 * @param ctx - Domain context of gameView.
 * @param recording - The recording.
 * @param value - The editor.series value.
 * @param elapsedMs - Tools-side length of the call.
 * @returns The written series.
 * @example
 * ```ts
 * await writeSeries(ctx, recording, value, 2004); // { folder, indexPath, shots: 20 }
 * ```
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

  const shots: SeriesShot[] = [];
  const images: string[] = [];
  let failure: unknown;
  for (const [index, shot] of value.shots.entries()) {
    const file = shotName(index, value.shots.length);
    try {
      await link.files.writeBinary(`${recording.folder}${file}`, shot.image);
    } catch (error) {
      failure = error;
      break;
    }
    shots.push({ file, frame: shot.frame, atMs: shot.atMs, bug: false });
    images.push(shot.image);
    recording.written = shots.length;
    notify(state);
  }

  const stopped = recording.stopRequested || failure !== undefined;
  const index: SeriesIndex = {
    label: recording.label,
    durationMs: stopped ? elapsedMs : recording.durationMs,
    intervalMs: recording.intervalMs,
    fromFrame: shots[0]?.frame ?? 0,
    shots,
    device: { name: workspace.device().preset.name, ...value.device }
  };
  if (stopped) index.stoppedEarly = true;

  const indexPath = `${recording.folder}index.json`;
  let version: string | undefined;
  try {
    const written = await link.files.write(indexPath, formatIndex(index));
    version = written.version;
  } catch (error) {
    failure ??= error;
  }

  if (failure === undefined) {
    workspace.toast(`✓ ${shots.length} shots saved`, recording.folder);
  } else {
    reportFailure(ctx, "Series not fully saved", "gameView: series write failed", failure);
  }
  state.series.recording = undefined;
  state.series.popover = false;
  state.series.sheet = { indexPath, index, images, version, big: undefined };
  notify(state);
  return { folder: recording.folder, indexPath, shots: shots.length };
}

/**
 * Records a series with one editor.series call and writes it; refuses while another runs.
 *
 * @param ctx - Domain context of gameView.
 * @param options - Length, spacing and an optional label.
 * @returns The written series, undefined when refused or failed (toasted).
 * @example
 * ```ts
 * await recordSeries(ctx, { durationMs: 200, intervalMs: 50 }); // { folder: ".moku/captures/series-2026-09-24-1015/", …, shots: 4 }
 * ```
 */
export async function recordSeries(
  ctx: GameViewCtx,
  options: SeriesOptions
): Promise<SeriesResult | undefined> {
  const { state, config } = ctx;
  const workspace = ctx.require(workspacePlugin);
  const busy = "A series is already recording.";
  if (state.series.recording !== undefined) {
    workspace.toast(busy);
    return undefined;
  }
  if (!gameReady(ctx.require(linkPlugin), GAME_COMMANDS.series)) {
    workspace.toast(NO_GAME_TEXT);
    return undefined;
  }

  workspace.show("game");
  const position = await currentPosition(ctx);
  const taken = await listTaken(ctx, config.capturesDir);
  if (state.series.recording !== undefined) {
    workspace.toast(busy);
    return undefined;
  }

  const { durationMs, intervalMs } = options;
  const recording: Recording = {
    folder: seriesFolder(config.capturesDir, stamp(new Date()), taken),
    label: options.label ?? position.path ?? "series",
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

  let value: SeriesValue | undefined;
  try {
    const ran = await ctx
      .require(panelsPlugin)
      .run(GAME_COMMANDS.series, { durationMs, intervalMs });
    value = seriesValueOf(ran.value);
    if (value === undefined) {
      throw new Error(
        "[moku-editor] editor.series returned no shots.\n  Update the game's capturePlugin."
      );
    }
  } catch (error) {
    state.series.recording = undefined;
    notify(state);
    reportFailure(ctx, "Series failed", "gameView: series failed", error);
    return undefined;
  }
  return writeSeries(ctx, recording, value, Math.round(performance.now() - recording.startedAt));
}

/**
 * Ends the running series early: marks it stopped and runs editor.seriesStop through panels
 * (R2, R9). The pending editor.series call then resolves with the shots taken so far.
 *
 * @param ctx - Domain context of gameView.
 * @example
 * ```ts
 * stopRecording(ctx); // panels.run("editor.seriesStop")
 * ```
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
