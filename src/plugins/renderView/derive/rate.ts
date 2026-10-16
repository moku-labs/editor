/**
 * @file renderView derive — the frame rate in words (spec 09 § M7 Rate now, § M9 Rate switch): the
 * rate now and its reason, the answer of `game.frameRate` (a held pin — `heldBy: "panel"`, or `asked`
 * above the answered `fps` — keeps `ok: false` and is never named as a platform cap), a refusal, and
 * the radio the switch shows checked. Pure.
 */
import type { Json } from "../../registry/protocol";
import type { PerfSecond } from "../source/contract";
import { rateFps } from "../source/contract";
import type { MissionState, MissionView, RateAnswer, RateChoice } from "../types";
import { messageOf, reasonOf } from "./words";

/**
 * The Rate now cell and the rate-now line: the rate, the em with its reason, calm or warn.
 *
 * @example
 * ```ts
 * const now: RateNow = { text: "60 fps", em: "adaptive, dropped from 120: missed frames", tone: "warn", pinned: false };
 * ```
 */
export type RateNow = {
  readonly text: string;
  readonly em: string;
  readonly tone: "calm" | "warn";
  readonly pinned: boolean;
};

/** A mode the loop is pinned in: `fixed` (no adaptive) or `forced` (`game.frameRate { fps }`). */
const PINNED_MODES: ReadonlySet<string> = new Set(["fixed", "forced"]);

/**
 * Whether the page is an iPhone or iPad (WKWebView caps frames there).
 *
 * @param second - The source's second.
 * @returns True on iOS.
 */
function isIos(second: PerfSecond): boolean {
  return /iPhone|iPad|iPod/u.test(second.device?.userAgent ?? "");
}

/**
 * The em of an adaptive rate below the display's, by its reason.
 *
 * @param second - The source's second.
 * @param fps - The rate now.
 * @param hz - The display's rate.
 * @returns The words.
 */
function droppedWords(second: PerfSecond, fps: number, hz: number): string {
  const { reason } = second.rate;
  if (reason === "missed") return `adaptive, dropped from ${hz}: missed frames`;
  if (reason === "thermal") return `adaptive, dropped from ${hz}: thermal`;
  if (reason === "headroom") return "adaptive, waiting for headroom";
  if (reason === "display" && isIos(second)) return `adaptive, WKWebView caps frames at ${fps}`;
  if (reason === "display") return `adaptive, the display runs at ${hz} Hz`;
  return `adaptive, below ${hz}`;
}

/**
 * The rate now in words (spec 09 § M7): pinned "{fps} fps, pinned" + "adaptive off"; adaptive and
 * resting "{rest fps} fps" + "adaptive, resting, game idle"; adaptive below the display's rate a warn
 * em by its reason; at the display's rate a calm "adaptive".
 *
 * @param second - The source's newest second.
 * @returns The words; undefined while the rate is not known ("—").
 * @example
 * ```ts
 * rateNow(second); // { text: "120 fps", em: "adaptive off", tone: "calm", pinned: true } after a pin at 120
 * ```
 */
export function rateNow(second: PerfSecond | undefined): RateNow | undefined {
  const fps = second?.rate.fps;
  if (second === undefined || fps === null || fps === undefined) return undefined;
  const { mode, displayHz } = second.rate;
  if (mode !== null && PINNED_MODES.has(mode)) {
    return { text: `${fps} fps, pinned`, em: "adaptive off", tone: "calm", pinned: true };
  }
  if (second.activity?.idle === true) {
    const rest = rateFps(second.budgetMs) || fps;
    return { text: `${rest} fps`, em: "adaptive, resting, game idle", tone: "calm", pinned: false };
  }
  if (displayHz !== null && fps < displayHz) {
    return {
      text: `${fps} fps`,
      em: droppedWords(second, fps, displayHz),
      tone: "warn",
      pinned: false
    };
  }
  return { text: `${fps} fps`, em: "adaptive", tone: "calm", pinned: false };
}

/**
 * The rate-now line under the radios: "Pinned · now {fps} fps (adaptive off)" or "Adaptive · now
 * {fps} fps ({why})".
 *
 * @param second - The source's newest second.
 * @returns The line and its tone; undefined while the rate is not known.
 * @example
 * ```ts
 * rateLine(second)?.text; // "Adaptive · now 60 fps (adaptive, dropped from 120: missed frames)"
 * ```
 */
export function rateLine(
  second: PerfSecond | undefined
): { readonly text: string; readonly tone: "calm" | "warn" } | undefined {
  const now = rateNow(second);
  const fps = second?.rate.fps;
  if (now === undefined || fps === null || fps === undefined) return undefined;
  if (now.pinned) return { text: `Pinned · now ${fps} fps (adaptive off)`, tone: "calm" };
  return { text: `Adaptive · now ${fps} fps (${now.em})`, tone: now.tone };
}

/**
 * The rate part of MissionView: fps, pinned or adaptive, why, the choice in flight, the last answer.
 *
 * @param second - The source's newest second.
 * @param rate - The switch's pending choice and last answer.
 * @returns The view.
 * @example
 * ```ts
 * rateView(second, mission.rate).mode; // "adaptive"
 * ```
 */
export function rateView(
  second: PerfSecond | undefined,
  rate: MissionState["rate"]
): MissionView["rate"] {
  const now = rateNow(second);
  let mode: MissionView["rate"]["mode"];
  if (now !== undefined) mode = now.pinned ? "pinned" : "adaptive";
  return {
    // eslint-disable-next-line unicorn/no-null -- null: the rate is not known
    fps: second?.rate.fps ?? null,
    mode,
    why: now?.em,
    pending: rate.pending,
    answer: rate.answer
  };
}

/** What a `game.frameRate` answer carries, read with its guard. */
type FrameRateValue = {
  readonly fps: number;
  readonly mode: "fixed" | "auto" | "forced";
  readonly reason: string;
  readonly displayHz: number | null;
  readonly asked: number | null;
  readonly heldBy: string | null;
};

/**
 * A field of a JSON object.
 *
 * @param value - The value.
 * @param key - The field.
 * @returns The field; undefined for a value that is not an object.
 */
function fieldOf(value: Json, key: string): Json | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value[key]
    : undefined;
}

/**
 * Reads a `game.frameRate` answer (the engine's FrameRate with `asked` and `heldBy`, absent on an
 * older engine).
 *
 * @param value - The answer's value.
 * @returns The fields; undefined for another shape.
 */
function frameRateOf(value: Json): FrameRateValue | undefined {
  const fps = fieldOf(value, "fps");
  const mode = fieldOf(value, "mode");
  if (typeof fps !== "number" || (mode !== "fixed" && mode !== "auto" && mode !== "forced")) {
    return undefined;
  }
  const displayHz = fieldOf(value, "displayHz");
  const asked = fieldOf(value, "asked");
  const heldBy = fieldOf(value, "heldBy");
  const reason = fieldOf(value, "reason");
  // eslint-disable-next-line unicorn/no-null -- null: not reported by this engine
  const none = null;
  return {
    fps,
    mode,
    reason: typeof reason === "string" ? reason : "",
    displayHz: typeof displayHz === "number" ? displayHz : none,
    asked: typeof asked === "number" ? asked : none,
    heldBy: typeof heldBy === "string" ? heldBy : none
  };
}

/**
 * The words of an adaptive answer: "Adaptive: running 60 — missed frames at 120", " — thermal", " on
 * this display".
 *
 * @param rate - The answer.
 * @returns The words.
 */
function adaptiveText(rate: FrameRateValue): string {
  const head = `Adaptive: running ${rate.fps}`;
  const hz = rate.displayHz;
  if (rate.reason === "missed" && hz !== null && rate.fps < hz) {
    return `${head} — missed frames at ${hz}`;
  }
  if (rate.reason === "thermal") return `${head} — thermal`;
  return hz === rate.fps ? `${head} on this display` : head;
}

/**
 * The answer of the rate switch in words. A held pin is `ok: false` so the radio stays on the
 * previous choice: `heldBy: "panel"` reads "Refused: this display runs at {displayHz} Hz"; `asked`
 * above the answered `fps` reads "Asked {asked} fps, the device runs {fps}" with no cause named.
 *
 * @param choice - What was asked.
 * @param value - game.frameRate's answer (FrameRate).
 * @returns The answer.
 * @example
 * ```ts
 * rateAnswerOf(120, { fps: 60, mode: "forced", reason: "forced", displayHz: 120, asked: 120, heldBy: null }).text;
 * // "Asked 120 fps, the device runs 60"
 * ```
 */
export function rateAnswerOf(choice: RateChoice, value: Json): RateAnswer {
  const rate = frameRateOf(value);
  if (rate === undefined)
    return { ok: false, choice, text: "Refused: the answer is not a frame rate" };
  if (rate.heldBy === "panel") {
    return {
      ok: false,
      choice,
      text: `Refused: this display runs at ${rate.displayHz ?? rate.fps} Hz`
    };
  }
  if (rate.asked !== null && rate.fps < rate.asked) {
    return { ok: false, choice, text: `Asked ${rate.asked} fps, the device runs ${rate.fps}` };
  }
  const text = PINNED_MODES.has(rate.mode)
    ? `Pinned at ${rate.fps}, adaptive off`
    : adaptiveText(rate);
  return { ok: true, choice, text, fps: rate.fps, mode: rate.mode };
}

/**
 * A rate switch that did not run, in words: "Refused: needs a debug build" (dev-only), "Not sent: no
 * source connected" (no session), else "Refused: {message}".
 *
 * @param choice - What was asked.
 * @param error - What the run rejected with.
 * @returns The answer.
 * @example
 * ```ts
 * rateRefusalOf(120, wireError(-32_009, "[moku-editor] refused", { reason: "dev_only" })).text; // "Refused: needs a debug build"
 * ```
 */
export function rateRefusalOf(choice: RateChoice, error: unknown): RateAnswer {
  const reason = reasonOf(error);
  if (reason === "dev_only") return { ok: false, choice, text: "Refused: needs a debug build" };
  if (reason === "no_session") return { ok: false, choice, text: "Not sent: no source connected" };
  return { ok: false, choice, text: `Refused: ${messageOf(error)}` };
}

/**
 * The radio the rate switch shows checked: the last answer's when it was taken, else the source's
 * rate (a pin at 60 or 120, else Adaptive). A refused or held answer leaves the previous choice.
 *
 * @param second - The source's newest second.
 * @param answer - The last answer of the switch.
 * @returns The choice; undefined while the rate is not known or pinned at another rate.
 * @example
 * ```ts
 * checkedRate(second, { ok: false, choice: 120, text: "Refused: this display runs at 60 Hz" }); // "adaptive": unchanged
 * ```
 */
export function checkedRate(
  second: PerfSecond | undefined,
  answer: RateAnswer | undefined
): RateChoice | undefined {
  if (answer?.ok === true) return choiceOf(answer.mode, answer.fps);
  const rate = second?.rate;
  if (rate?.fps === null || rate?.fps === undefined || rate.mode === null) return undefined;
  return choiceOf(rate.mode, rate.fps);
}

/**
 * The radio of a mode and rate.
 *
 * @param mode - The loop's mode.
 * @param fps - Its rate.
 * @returns The choice; undefined for a pin the switch does not offer.
 */
function choiceOf(mode: string, fps: number): RateChoice | undefined {
  if (!PINNED_MODES.has(mode)) return "adaptive";
  if (fps === 60 || fps === 120) return fps;
  return undefined;
}

/**
 * The command the pending line shows.
 *
 * @param choice - What is being asked.
 * @returns `game.frameRate {"fps":120}` or `game.frameRate {}`.
 * @example
 * ```ts
 * rateCommandText("adaptive"); // "game.frameRate {}"
 * ```
 */
export function rateCommandText(choice: RateChoice): string {
  return choice === "adaptive" ? "game.frameRate {}" : `game.frameRate {"fps":${choice}}`;
}
