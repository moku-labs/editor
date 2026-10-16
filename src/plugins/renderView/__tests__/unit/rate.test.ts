/* eslint-disable unicorn/no-null -- null is the engine's "not reported" */
import { describe, expect, it } from "vitest";
import { wireError } from "../../../registry/protocol";
import {
  checkedRate,
  rateAnswerOf,
  rateCommandText,
  rateLine,
  rateNow,
  rateRefusalOf,
  rateView
} from "../../derive/rate";
import type { PerfSecond } from "../../source/contract";
import { secondOf } from "../device-fixtures";

// ─────────────────────────────────────────────────────────────────────────────
// derive/rate.ts (spec 09 § M7 Rate now, § M9 Rate switch): the rate in words,
// the answers of game.frameRate and the radio kept checked.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A second with a rate.
 *
 * @param rate - The rate's fields.
 * @param extra - Other fields.
 * @returns The second.
 */
function withRate(rate: Partial<PerfSecond["rate"]>, extra: Partial<PerfSecond> = {}): PerfSecond {
  const base = secondOf();
  return { ...base, ...extra, rate: { ...base.rate, ...rate } };
}

const IPHONE = {
  model: "iPhone",
  modelFrom: "ua" as const,
  cores: 6,
  memoryGb: 6,
  userAgent:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148",
  webview: null
};

describe("rate now", () => {
  it("fixed 120 reads '120 fps, pinned' / 'adaptive off'", () => {
    // Bug: a pinned rate described as the adaptive rule's choice.
    expect(rateNow(withRate({ fps: 120, mode: "fixed", displayHz: 120 }))).toMatchObject({
      text: "120 fps, pinned",
      em: "adaptive off",
      tone: "calm"
    });
    expect(rateLine(withRate({ fps: 120, mode: "forced" }))?.text).toBe(
      "Pinned · now 120 fps (adaptive off)"
    );
  });

  it("auto 60 on a 120 Hz display with reason missed reads 'dropped from 120: missed frames' in warn", () => {
    // Bug: a drop the rule made shown as calm, or the reason left out.
    const second = withRate({ fps: 60, mode: "auto", reason: "missed", displayHz: 120 });
    expect(rateNow(second)).toMatchObject({
      em: "adaptive, dropped from 120: missed frames",
      tone: "warn"
    });
    expect(rateLine(second)).toEqual({
      text: "Adaptive · now 60 fps (adaptive, dropped from 120: missed frames)",
      tone: "warn"
    });
  });

  it("auto at the display rate is calm", () => {
    // Bug: a warn at 120/120.
    expect(
      rateNow(withRate({ fps: 120, mode: "auto", reason: "start", displayHz: 120 }))
    ).toMatchObject({
      em: "adaptive",
      tone: "calm"
    });
  });

  it("resting reads 'resting, game idle' at the rest rate", () => {
    // Bug: a resting game shown as a drop to 30 fps.
    const second = withRate(
      { fps: 120, mode: "auto", displayHz: 120 },
      {
        budgetMs: 33.3,
        activity: { idle: true, idleSince: 1, idleFrames: 90, idleMs: 3000, breaks: 0, p90Ms: 8 }
      }
    );
    expect(rateNow(second)).toMatchObject({
      text: "30 fps",
      em: "adaptive, resting, game idle",
      tone: "calm"
    });
  });

  it("the display reason on iOS names the WKWebView cap, elsewhere the display's rate", () => {
    // Bug: an Android phone at 60 Hz described as capped by WKWebView.
    const ios = withRate(
      { fps: 60, mode: "auto", reason: "display", displayHz: 120 },
      { device: IPHONE }
    );
    expect(rateNow(ios)?.em).toBe("adaptive, WKWebView caps frames at 60");
    const android = withRate({ fps: 60, mode: "auto", reason: "display", displayHz: 120 });
    expect(rateNow(android)?.em).toBe("adaptive, the display runs at 120 Hz");
    expect(rateNow(withRate({ fps: null }))).toBeUndefined();
  });

  it("the view says pinned or adaptive with the why, and keeps the pending choice and answer", () => {
    // Bug: the MCP view of the rate missing what the page shows.
    const view = rateView(withRate({ fps: 60, mode: "auto", reason: "missed", displayHz: 120 }), {
      pending: 120,
      answer: undefined
    });
    expect(view).toEqual({
      fps: 60,
      mode: "adaptive",
      why: "adaptive, dropped from 120: missed frames",
      pending: 120,
      answer: undefined
    });
    expect(rateView(undefined, { pending: undefined, answer: undefined }).fps).toBeNull();
  });
});

describe("rate answers", () => {
  it("asked 120, fps 60, heldBy null reads 'Asked 120 fps, the device runs 60' with no cause named", () => {
    // Bug: an invented WKWebView claim for a cap the engine did not explain.
    const answer = rateAnswerOf(120, {
      fps: 60,
      mode: "forced",
      reason: "forced",
      displayHz: 120,
      asked: 120,
      heldBy: null
    });
    expect(answer).toEqual({ ok: false, choice: 120, text: "Asked 120 fps, the device runs 60" });
  });

  it("an answer held by the display reads 'Refused: this display runs at 60 Hz' and keeps the previous choice", () => {
    // Bug: the radio following a refused pin.
    const answer = rateAnswerOf(120, {
      fps: 60,
      mode: "auto",
      reason: "display",
      displayHz: 60,
      asked: 120,
      heldBy: "panel"
    });
    expect(answer.text).toBe("Refused: this display runs at 60 Hz");
    expect(answer.ok).toBe(false);
    expect(checkedRate(withRate({ fps: 60, mode: "auto" }), answer)).toBe("adaptive");
  });

  it("a pin answers 'Pinned at 120, adaptive off' and the radio follows it", () => {
    // Bug: the radio stays on Adaptive after a pin that took.
    const answer = rateAnswerOf(120, {
      fps: 120,
      mode: "forced",
      reason: "forced",
      displayHz: 120,
      asked: 120,
      heldBy: null
    });
    expect(answer).toEqual({
      ok: true,
      choice: 120,
      text: "Pinned at 120, adaptive off",
      fps: 120,
      mode: "forced"
    });
    expect(checkedRate(withRate({ fps: 60, mode: "auto" }), answer)).toBe(120);
  });

  it("Adaptive answer at 60 after missed reads 'Adaptive: running 60 — missed frames at 120'", () => {
    // Bug: "Adaptive" alone, hiding that the rule dropped the rate.
    expect(
      rateAnswerOf("adaptive", { fps: 60, mode: "auto", reason: "missed", displayHz: 120 }).text
    ).toBe("Adaptive: running 60 — missed frames at 120");
    expect(
      rateAnswerOf("adaptive", { fps: 120, mode: "auto", reason: "start", displayHz: 120 }).text
    ).toBe("Adaptive: running 120 on this display");
    expect(
      rateAnswerOf("adaptive", { fps: 30, mode: "auto", reason: "thermal", displayHz: 120 }).text
    ).toBe("Adaptive: running 30 — thermal");
    expect(rateAnswerOf(60, "nope").ok).toBe(false);
  });

  it("a dev-only control error reads 'Refused: needs a debug build'; no session 'Not sent'; others their message", () => {
    // Bug: a release build's refusal shown as an engine bug.
    const devOnly = wireError(-32_009, "[moku-editor] game.frameRate is dev-only", {
      reason: "dev_only"
    });
    const noSession = wireError(-32_003, "[moku-editor] no session", { reason: "no_session" });
    expect(rateRefusalOf(120, devOnly).text).toBe("Refused: needs a debug build");
    expect(rateRefusalOf(120, { data: { reason: "dev-only" } }).text).toBe(
      "Refused: needs a debug build"
    );
    expect(rateRefusalOf(120, noSession).text).toBe("Not sent: no source connected");
    expect(
      rateRefusalOf(60, new Error("[moku-editor] fps must be 30, 60 or 120.\n  Pass one.")).text
    ).toBe("Refused: fps must be 30, 60 or 120.");
  });

  it("the pending line names the command sent", () => {
    // Bug: { fps: "adaptive" } shown as the command.
    expect(rateCommandText(120)).toBe('game.frameRate {"fps":120}');
    expect(rateCommandText("adaptive")).toBe("game.frameRate {}");
  });
});

describe("rate edges", () => {
  it("an adaptive rate below the display for another reason reads 'adaptive, below {hz}'; a pin the switch does not offer checks no radio", () => {
    // Bug: a 30 fps pin shown as Adaptive checked.
    expect(rateNow(withRate({ fps: 60, mode: "auto", reason: "start", displayHz: 120 }))?.em).toBe(
      "adaptive, below 120"
    );
    expect(checkedRate(withRate({ fps: 30, mode: "forced" }), undefined)).toBeUndefined();
    expect(checkedRate(undefined, undefined)).toBeUndefined();
    expect(rateLine(undefined)).toBeUndefined();
  });
});
