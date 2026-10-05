/**
 * @file capture plugin — type definitions: config, constants, state, the command values, the
 * picture decoder seam, the picture request, the registry slice, the domain deps and the plugin
 * context. No app api (the surface is the registry catalogue).
 */
import type { Log } from "@moku-labs/common/browser";
import type { Require } from "../../config";
import type { RunState, SelectionRect } from "../registry/protocol";
import type { CommandEntry, SourceEntry } from "../registry/types";

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
 * The id of the contact-sheet command, named in its errors.
 */
export const SHEET_ID = "editor.sheet";

/**
 * The fewest pictures a contact sheet takes (the game's own limit).
 */
export const MIN_SHEET_FRAMES = 2;

/**
 * The most pictures a contact sheet takes (the game's own limit).
 */
export const MAX_SHEET_FRAMES = 12;

/**
 * The shortest game time between two pictures of a contact sheet, in ms.
 */
export const MIN_SHEET_EVERY_MS = 1;

/**
 * The longest game time between two pictures of a contact sheet, in ms.
 */
export const MAX_SHEET_EVERY_MS = 5000;

/**
 * The smallest `maxWidth` editor.capture and editor.sheet accept, in pixels.
 */
export const MIN_MAX_WIDTH = 64;

/**
 * The largest `maxWidth` editor.capture and editor.sheet accept, in pixels.
 */
export const MAX_MAX_WIDTH = 4096;

/**
 * The format editor.capture and editor.sheet encode when the input names none (D-34).
 */
export const DEFAULT_FORMAT: PictureFormat = "jpeg";

/**
 * The JPEG quality editor.capture and editor.sheet encode with when the input names none (D-34).
 */
export const DEFAULT_QUALITY = 0.8;

/**
 * The padding around a cropped element, in page CSS px (scaled to picture pixels).
 */
export const CROP_PADDING = 8;

/**
 * The sources an element's page rect is read from, newest first: `game.locate` on game 0.4,
 * `game.rect` on game 0.1. Both take `{ key }` and answer `{ x, y, w, h }` in page CSS px, or null.
 */
export const RECT_SOURCE_IDS = ["game.locate", "game.rect"] as const;

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
 * Value of `editor.sheet`: the contact sheet (one JPEG or PNG data URL), the frame of the last picture and
 * the device.
 */
export type Sheet = { readonly image: string; readonly frame: number; readonly device: Device };

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
 * The format a picture is encoded in: `"jpeg"` (the default, D-34) or `"png"` (the old lossless path).
 */
export type PictureFormat = "jpeg" | "png";

/**
 * A size in picture pixels.
 */
export type PictureSize = { readonly width: number; readonly height: number };

/**
 * A rect in picture pixels (the crop of a decoded picture), whole numbers.
 */
export type PixelRect = {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/**
 * How to encode a decoded picture: the part to keep, the size to draw it at, the format and the
 * JPEG quality.
 */
export type EncodeOptions = {
  /** The part of the picture to draw; absent = the whole picture. */
  readonly crop?: PixelRect;
  /** The size of the encoded picture. */
  readonly size: PictureSize;
  readonly format: PictureFormat;
  /** JPEG quality above 0 and at most 1; png ignores it. */
  readonly quality: number;
};

/**
 * A picture decoded in the page: its size in pixels, a way to encode it and a way to free it.
 */
export type DecodedPicture = PictureSize & {
  /** Draws the crop (or the whole picture) at `size` and answers it as a data URL of the blob's type. */
  encode(options: EncodeOptions): Promise<string>;
  /** Frees the decoded pixels. */
  close(): void;
};

/**
 * Decodes a PNG data URL in the page (`decodePicture` in canvas.ts; tests pass a fake).
 */
export type PictureDecoder = (image: string) => Promise<DecodedPicture>;

/**
 * Where editor.capture crops: a rect in page CSS px and the input field it came from (named in
 * its errors).
 */
export type CropRequest = { readonly rect: SelectionRect; readonly field: "key" | "rect" };

/**
 * What editor.capture and editor.sheet ask of the door's picture: crop, then downscale, then encode.
 */
export type PictureRequest = {
  /** The widest picture wanted, undefined = no downscale. */
  readonly maxWidth: number | undefined;
  /** The part to keep, undefined = the whole picture. */
  readonly crop: CropRequest | undefined;
  readonly format: PictureFormat;
  readonly quality: number;
  /** The game page width in CSS px (`readDevice().w`); 0 when unknown. */
  readonly deviceWidth: number;
};

/**
 * The registry members capture uses.
 */
export type CaptureRegistry = {
  command(id: string): CommandEntry | undefined;
  /** The rect source of a key (`game.locate` or `game.rect`), looked up at run time. */
  source(id: string): SourceEntry | undefined;
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
  /** Decodes a shot or a sheet for the crop, the downscale and the encoding of editor.capture and editor.sheet. */
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
