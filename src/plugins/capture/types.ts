/**
 * @file capture plugin — type definitions: config, constants, state, the command values, the
 * picture decoder seam, the registry slice, the domain deps and the plugin context. No app api (the surface is the
 * registry catalogue).
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { RunState } from "../registry/protocol";
import type { CommandEntry } from "../registry/types";

/**
 * A plan above this many shots logs `capture:series-large` and still runs.
 */
export const WARN_SHOTS = 200;

/**
 * The door command every shot runs.
 */
export const CAPTURE_ID = "game.capture";

/**
 * The id of the one-shot command, named in its errors.
 */
export const SHOT_ID = "editor.capture";

/**
 * The smallest `maxWidth` editor.capture accepts, in pixels.
 */
export const MIN_MAX_WIDTH = 64;

/**
 * The largest `maxWidth` editor.capture accepts, in pixels.
 */
export const MAX_MAX_WIDTH = 4096;

/**
 * Capture configuration.
 *
 * @example
 * ```ts
 * createApp({ plugins: [capturePlugin], pluginConfigs: { capture: { maxDurationMs: 10_000 } } });
 * ```
 */
export type Config = {
  /** Longest series accepted, in ms. Default 20000. */
  maxDurationMs: number;
  /** Shortest interval accepted, in ms. Default 16. */
  minIntervalMs: number;
};

/**
 * The series being recorded.
 */
export type SeriesRun = {
  /** Set by editor.seriesStop or onStop; the loop checks it before every shot. */
  stopRequested: boolean;
  /** The pending wait between two shots, cleared on stop. */
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Resolves the pending wait early (stop). */
  wake: (() => void) | undefined;
};

/**
 * Capture state: at most one series at a time.
 */
export type CaptureState = { series: SeriesRun | undefined };

/**
 * The game page viewport of a shot (not the tools-side DeviceSpec).
 */
export type Device = {
  readonly w: number;
  readonly h: number;
  readonly orientation: "portrait" | "landscape";
};

/**
 * Value of `editor.capture`.
 */
export type Shot = { readonly image: string; readonly frame: number; readonly device: Device };

/**
 * One shot of a series, tagged with its real frame and real time.
 */
export type SeriesShot = { readonly image: string; readonly frame: number; readonly atMs: number };

/**
 * Value of `editor.series` (R2).
 */
export type SeriesValue = { readonly shots: readonly SeriesShot[]; readonly device: Device };

/**
 * A validated series plan: shot k is due at k × intervalMs.
 */
export type SeriesPlan = {
  readonly count: number;
  readonly durationMs: number;
  readonly intervalMs: number;
};

/**
 * What recordSeries hands back: the shots, the state of the last good shot, the skipped count.
 */
export type SeriesResult = {
  readonly shots: readonly SeriesShot[];
  readonly state: RunState | undefined;
  readonly skipped: number;
};

/**
 * Time seam of the series loop (performance.now and a stoppable setTimeout wait).
 */
export type CaptureClock = {
  now(): number;
  wait(ms: number, run: SeriesRun): Promise<void>;
};

/**
 * A picture decoded in the page: its size in pixels, a way to draw it smaller and a way to free it.
 */
export type DecodedPicture = {
  readonly width: number;
  readonly height: number;
  /** Draws the picture at `width` × `height` and answers it as a PNG data URL. */
  toPng(width: number, height: number): Promise<string>;
  /** Frees the decoded pixels. */
  close(): void;
};

/**
 * Decodes a PNG data URL in the page (`decodePicture` in canvas.ts; tests pass a fake).
 */
export type PictureDecoder = (image: string) => Promise<DecodedPicture>;

/**
 * The registry members capture uses.
 */
export type CaptureRegistry = {
  command(id: string): CommandEntry | undefined;
  add(entry: CommandEntry): void;
  envelope(): RunState;
};

/**
 * Domain dependencies of the capture modules.
 */
export type CaptureDeps = {
  readonly config: Readonly<Config>;
  readonly state: CaptureState;
  readonly log: Log.LogApi;
  readonly clock: CaptureClock;
  /** Decodes a shot for the `maxWidth` downscale of editor.capture. */
  readonly decode: PictureDecoder;
};

/**
 * Plugin context of capture: the kernel context is assignable to it.
 */
export type CaptureCtx = {
  readonly config: Readonly<Config>;
  state: CaptureState;
  readonly log: Log.LogApi;
  readonly require: Require;
};
