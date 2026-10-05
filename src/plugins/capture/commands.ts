/**
 * @file capture plugin — builds the editor.capture, editor.series, editor.seriesStop and
 * editor.sheet entries and adds them to the registry. No entry runs on its own: a picture exists
 * only because a caller ran one of these commands.
 */
import type { Json, RunResult } from "../registry/protocol";
import { checkInput, errorCode, wireError } from "../registry/protocol";
import type { CommandEntry } from "../registry/types";
import { readDevice } from "./device";
import { checkEncoding } from "./encoding";
import { cropOf } from "./locate";
import { renderPicture } from "./picture";
import { checkMaxWidth } from "./scale";
import { noPicture, planSeries, recordSeries, SERIES_ID, stopSeries } from "./series";
import { checkSheet } from "./sheet";
import { takeShot } from "./shot";
import type { CaptureDeps, CaptureRegistry, SeriesValue, Sheet, Shot } from "./types";
import { SHEET_ID, SHOT_ID, WARN_SHOTS } from "./types";

/**
 * The input schema of editor.capture.
 */
const CAPTURE_INPUT: {
  readonly maxWidth: "number?";
  readonly key: "string?";
  readonly rect: "json?";
  readonly format: "string?";
  readonly quality: "number?";
} = { maxWidth: "number?", key: "string?", rect: "json?", format: "string?", quality: "number?" };

/**
 * The input schema of editor.series.
 */
const SERIES_INPUT: { readonly durationMs: "number"; readonly intervalMs: "number" } = {
  durationMs: "number",
  intervalMs: "number"
};

/**
 * The input schema of editor.sheet.
 */
const SHEET_INPUT: {
  readonly frames: "number";
  readonly everyMs: "number";
  readonly maxWidth: "number?";
  readonly format: "string?";
  readonly quality: "number?";
} = {
  frames: "number",
  everyMs: "number",
  maxWidth: "number?",
  format: "string?",
  quality: "number?"
};

/**
 * Builds the editor.capture entry: one screenshot with its frame and device, cropped to `key` or
 * `rect`, shrunk to `maxWidth` and encoded in `format` (JPEG 0.8 by default).
 *
 * @param registry - The registry slice.
 * @param deps - The picture decoder and the log.
 * @returns The entry.
 */
function captureEntry(registry: CaptureRegistry, deps: CaptureDeps): CommandEntry {
  return {
    descriptor: { id: SHOT_ID, title: "Screenshot", input: CAPTURE_INPUT, effect: "read" },
    /**
     * Checks the input and finds the crop before the door runs, takes one shot, renders it and
     * tags it with its frame and the device.
     *
     * @param raw - Raw input (`null`, `{}` or `{ maxWidth?, key?, rect?, format?, quality? }`).
     * @returns The shot and the state game.capture ran with.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const input = checkInput(CAPTURE_INPUT, raw);
      const maxWidth = checkMaxWidth(input.maxWidth);
      const encoding = checkEncoding(input);
      const crop = cropOf(input, registry);

      const shot = await takeShot(registry);
      const { state } = shot;
      const device = readDevice();
      const request = { maxWidth, crop, ...encoding, deviceWidth: device.w };
      const image = await renderPicture(shot.image, request, deps);
      const value: Shot = { image, frame: state.frame, device };

      return { value, state };
    }
  };
}

/**
 * Builds the editor.series entry: a timed series in one call (never split into chunks).
 *
 * @param registry - The registry slice.
 * @param deps - Config, state, log and clock.
 * @returns The entry.
 */
function seriesEntry(registry: CaptureRegistry, deps: CaptureDeps): CommandEntry {
  return {
    descriptor: { id: SERIES_ID, title: "Record a series", input: SERIES_INPUT, effect: "read" },
    /**
     * Checks and plans the input, refuses a second series, records it and answers the shots.
     *
     * @param raw - Raw input `{ durationMs, intervalMs }`.
     * @returns The shots and the device, with the state of the last good shot.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const plan = planSeries(checkInput(SERIES_INPUT, raw), deps.config);

      if (deps.state.series !== undefined) {
        throw wireError(
          errorCode.commandFailed,
          "[moku-editor] A series is already recording.\n  Stop it or wait for it to end.",
          { reason: "command_failed", retryable: false, id: SERIES_ID }
        );
      }
      if (plan.count > WARN_SHOTS) {
        const { count, durationMs, intervalMs } = plan;
        deps.log.warn("capture:series-large", { count, durationMs, intervalMs });
      }

      const { shots, state } = await recordSeries(plan, registry, deps);

      if (state === undefined) throw noPicture();

      const value = { shots: [...shots], device: readDevice() } satisfies SeriesValue;

      return { value, state };
    }
  };
}

/**
 * Builds the editor.seriesStop entry: ends a running series early; its state is the registry
 * envelope (it runs no door).
 *
 * @param registry - The registry slice.
 * @param deps - The capture deps (state).
 * @returns The entry.
 */
function seriesStopEntry(registry: CaptureRegistry, deps: CaptureDeps): CommandEntry {
  return {
    descriptor: { id: "editor.seriesStop", title: "Stop the series", input: {}, effect: "read" },
    /**
     * Checks the empty input and ends the running series, if any.
     *
     * @param raw - Raw input (`null` or `{}`).
     * @returns Whether a series was stopped, with the registry envelope.
     */
    run: async (raw: Json): Promise<RunResult> => {
      checkInput({}, raw);

      return { value: { stopped: stopSeries(deps.state) }, state: registry.envelope() };
    }
  };
}

/**
 * Builds the editor.sheet entry: one game.capture `{ sheet }` (the frames laid out on one picture
 * by the game), shrunk to `maxWidth` and encoded in `format` (JPEG 0.8 by default) in the page, so
 * it travels small.
 *
 * @param registry - The registry slice.
 * @param deps - The picture decoder and the log.
 * @returns The entry.
 */
function sheetEntry(registry: CaptureRegistry, deps: CaptureDeps): CommandEntry {
  return {
    descriptor: { id: SHEET_ID, title: "Contact sheet", input: SHEET_INPUT, effect: "read" },
    /**
     * Checks the input, runs game.capture `{ sheet }` once, renders the sheet and tags it with
     * the frame of the last picture and the device.
     *
     * @param raw - Raw input `{ frames, everyMs, maxWidth?, format?, quality? }`.
     * @returns The sheet and the state game.capture ran with.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const input = checkInput(SHEET_INPUT, raw);
      const sheet = checkSheet(input);
      const maxWidth = checkMaxWidth(input.maxWidth, SHEET_ID);
      const encoding = checkEncoding(input, SHEET_ID);

      const shot = await takeShot(registry, { sheet }, SHEET_ID);
      const { state } = shot;
      const device = readDevice();
      const request = { maxWidth, crop: undefined, ...encoding, deviceWidth: device.w };
      const image = await renderPicture(shot.image, request, deps);
      const value: Sheet = { image, frame: state.frame, device };

      return { value, state };
    }
  };
}

/**
 * Adds the four capture commands (ids, inputs, effects from contracts §3 and R2; editor.sheet from
 * the MCP change).
 *
 * @param registry - The registry slice (add, command, source, envelope).
 * @param deps - Config, state, log, clock and the picture decoder.
 * @throws {Error} When an id is already in the registry.
 */
export function registerCaptureCommands(registry: CaptureRegistry, deps: CaptureDeps): void {
  registry.add(captureEntry(registry, deps));
  registry.add(seriesEntry(registry, deps));
  registry.add(seriesStopEntry(registry, deps));
  registry.add(sheetEntry(registry, deps));
}
