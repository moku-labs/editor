/**
 * @file renderView derive — the rate switch and the rate-now line (spec 09 § M7, M9): the
 * answer of `game.frameRate` in words, a held pin (`heldBy: "panel"`, or `asked` above the
 * answered `fps`) never named as a platform cap. Pure. Typed stub of build wave 0 (spec 09 §
 * M17, RV0): the signatures are the contract the other Mission control units build against;
 * build wave 3 (RV3) writes the bodies.
 */
import type { Json } from "../../registry/protocol";
import type { PerfSecond } from "../source/contract";
import { notBuilt } from "../stub";
import type { MissionState, MissionView, RateAnswer, RateChoice } from "../types";

/**
 * The rate part of MissionView: fps, pinned or adaptive, why, pending, answer.
 *
 * @param _second - The source's newest second.
 * @param _rate - The switch's pending choice and last answer.
 * @returns The view.
 * @throws {Error} Until build wave 3: "renderView derive/rateView is not built yet".
 */
export function rateView(
  _second: PerfSecond | undefined,
  _rate: MissionState["rate"]
): MissionView["rate"] {
  return notBuilt("derive/rateView", 3);
}

/**
 * The answer in words; a held pin keeps `ok: false` so the radio stays on the previous choice.
 *
 * @param _choice - What was asked.
 * @param _value - game.frameRate's answer (FrameRate).
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView derive/rateAnswerOf is not built yet".
 */
export function rateAnswerOf(_choice: RateChoice, _value: Json): RateAnswer {
  return notBuilt("derive/rateAnswerOf", 3);
}

/**
 * A refused switch in words: "Refused: needs a debug build", "Not sent: no source connected",
 * "Refused: {message}".
 *
 * @param _choice - What was asked.
 * @param _error - What the run rejected with.
 * @returns The answer.
 * @throws {Error} Until build wave 3: "renderView derive/rateRefusalOf is not built yet".
 */
export function rateRefusalOf(_choice: RateChoice, _error: unknown): RateAnswer {
  return notBuilt("derive/rateRefusalOf", 3);
}
