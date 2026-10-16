/**
 * @file renderView actions — the rate switch (spec 09 § M9): runs `game.frameRate { fps }` or `{}`
 * (adaptive) on the active source, one in flight (a second call answers Busy at once), the answer or
 * the refusal kept for the answer line; a late answer after a source switch is dropped.
 */
import { linkPlugin } from "../../link";
import { rateAnswerOf, rateRefusalOf } from "../derive/rate";
import { notifyMission } from "../state";
import type { RateAnswer, RateChoice, RenderViewCtx } from "../types";

/**
 * Runs the switch; never rejects.
 *
 * @param ctx - Domain context of renderView.
 * @param choice - 60, 120 or "adaptive".
 * @returns The answer.
 * @example
 * ```ts
 * await runRate(ctx, 120); // { ok: true, choice: 120, text: "Pinned at 120, adaptive off", fps: 120, mode: "forced" }
 * ```
 */
export async function runRate(ctx: RenderViewCtx, choice: RateChoice): Promise<RateAnswer> {
  const { mission } = ctx.state;
  if (mission.rate.pending !== undefined) {
    return { ok: false, choice, text: "Busy: a rate change is still pending" };
  }
  const source = mission.source;
  mission.rate.pending = choice;
  mission.rate.answer = undefined;
  notifyMission(mission);
  let answer: RateAnswer;
  try {
    const input = choice === "adaptive" ? {} : { fps: choice };
    const result = await ctx.require(linkPlugin).run("game.frameRate", input);
    answer = rateAnswerOf(choice, result.value);
  } catch (error) {
    answer = rateRefusalOf(choice, error);
  }
  if (mission.source !== source) return answer;
  mission.rate.pending = undefined;
  mission.rate.answer = answer;
  notifyMission(mission);
  return answer;
}
