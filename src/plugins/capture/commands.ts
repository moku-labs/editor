/**
 * @file capture plugin — builds the editor.capture, editor.series, editor.seriesStop and
 * editor.sheet entries and adds them to the registry. No entry runs on its own: a picture exists
 * only because a caller ran one of these commands.
 */
import type { Json, RunResult } from "../registry/protocol";
import { checkInput, errorCode, wireError } from "../registry/protocol";
import type { CommandEntry } from "../registry/types";
import { readDevice } from "./device";
import { checkMaxWidth, fitWidth } from "./scale";
import { noPicture, planSeries, recordSeries, SERIES_ID, stopSeries } from "./series";
import { checkSheet } from "./sheet";
import { takeShot } from "./shot";
import type { CaptureDeps, CaptureRegistry, SeriesValue, Sheet, Shot } from "./types";
import { SHEET_ID, SHOT_ID, WARN_SHOTS } from "./types";

/**
 * The input schema of editor.capture.
 */
const CAPTURE_INPUT: { readonly maxWidth: "number?" } = { maxWidth: "number?" };

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
} = { frames: "number", everyMs: "number", maxWidth: "number?" };

/**
 * Builds the editor.capture entry: one screenshot with its frame and device, shrunk to
 * `maxWidth` when the picture is wider.
 *
 * @param registry - The registry slice.
 * @param deps - The picture decoder and the log.
 * @returns The entry.
 */
function captureEntry(registry: CaptureRegistry, deps: CaptureDeps): CommandEntry {
  return {
    descriptor: { id: SHOT_ID, title: "Screenshot", input: CAPTURE_INPUT, effect: "read" },
    /**
     * Checks the input, takes one shot, shrinks it to `maxWidth` when asked and tags it with its
     * frame and the device.
     *
     * @param raw - Raw input (`null`, `{}` or `{ maxWidth }`).
     * @returns The shot and the state game.capture ran with.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const maxWidth = checkMaxWidth(checkInput(CAPTURE_INPUT, raw).maxWidth);
      const shot = await takeShot(registry);
      const { state } = shot;
      const image =
        maxWidth === undefined ? shot.image : await fitWidth(shot.image, maxWidth, deps);
      const value: Shot = { image, frame: state.frame, device: readDevice() };

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
 * by the game), shrunk to `maxWidth` in the page when the sheet is wider, so it travels small.
 *
 * @param registry - The registry slice.
 * @param deps - The picture decoder and the log.
 * @returns The entry.
 */
function sheetEntry(registry: CaptureRegistry, deps: CaptureDeps): CommandEntry {
  return {
    descriptor: { id: SHEET_ID, title: "Contact sheet", input: SHEET_INPUT, effect: "read" },
    /**
     * Checks the input, runs game.capture `{ sheet }` once, shrinks the sheet to `maxWidth` when
     * asked and tags it with the frame of the last picture and the device.
     *
     * @param raw - Raw input `{ frames, everyMs, maxWidth? }`.
     * @returns The sheet and the state game.capture ran with.
     */
    run: async (raw: Json): Promise<RunResult> => {
      const input = checkInput(SHEET_INPUT, raw);
      const sheet = checkSheet(input);
      const maxWidth = checkMaxWidth(input.maxWidth, SHEET_ID);
      const shot = await takeShot(registry, { sheet }, SHEET_ID);
      const { state } = shot;
      const image =
        maxWidth === undefined ? shot.image : await fitWidth(shot.image, maxWidth, deps);
      const value: Sheet = { image, frame: state.frame, device: readDevice() };

      return { value, state };
    }
  };
}

/**
 * Adds the four capture commands (ids, inputs, effects from contracts §3 and R2; editor.sheet from
 * the MCP change).
 *
 * @param registry - The registry slice (add, command, envelope).
 * @param deps - Config, state, log, clock and the picture decoder.
 * @throws {Error} When an id is already in the registry.
 */
export function registerCaptureCommands(registry: CaptureRegistry, deps: CaptureDeps): void {
  registry.add(captureEntry(registry, deps));
  registry.add(seriesEntry(registry, deps));
  registry.add(seriesStopEntry(registry, deps));
  registry.add(sheetEntry(registry, deps));
}
