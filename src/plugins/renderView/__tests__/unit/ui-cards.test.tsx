// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is a JSON value on the wire and the engine's "not reported" */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { demoDirectory } from "../device-fixtures";
import { stubFrames } from "../helpers";
import { type MissionCtx, missionCtx } from "../mission-ctx";
import { answer, click, feedDemo, fire, type Mounted, mountRender } from "../mission-ui";

// ─────────────────────────────────────────────────────────────────────────────
// components/cards/RateSwitch.tsx and the cards (spec 09 § M9, M16 ui-cards):
// the rate radios are a real radiogroup with a roving tabindex whose arrow keys
// move and send; a refused or held pin keeps the previous radio checked, a
// taken one moves it; the pending line names the command; a waiting source's
// cards say so instead of showing zeros.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: MissionCtx;
let view: Mounted;

/**
 * The rate radios: their label, aria-checked and tabindex.
 *
 * @returns The radios.
 */
function radios(): { label: string; checked: string | null; tab: number }[] {
  return view.all("[role='radiogroup'][data-segmented='rate'] [role='radio']").map(radio => ({
    label: radio.textContent ?? "",
    checked: radio.getAttribute("aria-checked"),
    tab: radio.tabIndex
  }));
}

beforeEach(() => {
  stubFrames();
  ctx = missionCtx({ device: true });
  ctx.activeSource.directoryValue = demoDirectory();
  view = mountRender(ctx);
  feedDemo(ctx);
});

afterEach(() => {
  view.unmount();
  vi.unstubAllGlobals();
});

describe("the rate switch", () => {
  it("is a radiogroup with a roving tabindex; an arrow key moves the focus and sends that rate", () => {
    const group = view.q("[role='radiogroup'][data-segmented='rate']");
    expect(group?.getAttribute("aria-label")).toBe("Frame rate on Galaxy A26");
    expect(radios()).toEqual([
      { label: "60", checked: "false", tab: -1 },
      { label: "120", checked: "false", tab: -1 },
      { label: "Adaptive", checked: "true", tab: 0 }
    ]);

    const adaptive = view.all("[data-segmented='rate'] [role='radio']")[2];
    adaptive?.focus();
    fire(adaptive ?? null, new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));

    expect(document.activeElement?.textContent).toBe("120");
    expect(ctx.runs.at(-1)).toMatchObject({ id: "game.frameRate", input: { fps: 120 } });
    expect(view.q("[data-rate-answer='pending']")?.textContent).toBe(
      'game.frameRate {"fps":120}sent to Galaxy A26…'
    );
  });

  it("a held pin keeps the previous radio checked; a taken pin moves it", async () => {
    click(view.all("[data-segmented='rate'] [role='radio']")[1] ?? null);
    await answer(ctx.runs, "game.frameRate", {
      fps: 120,
      mode: "auto",
      reason: "display",
      displayHz: 120,
      asked: 120,
      heldBy: "panel"
    });
    expect(radios().map(radio => radio.checked)).toEqual(["false", "false", "true"]);
    expect(view.q("[data-rate-answer]")?.dataset.rateAnswer).toBe("error");
    expect(view.q("[data-rate-answer]")?.textContent).toContain(
      "Refused: this display runs at 120 Hz"
    );

    click(view.all("[data-segmented='rate'] [role='radio']")[0] ?? null);
    await answer(ctx.runs, "game.frameRate", {
      fps: 60,
      mode: "fixed",
      reason: "forced",
      displayHz: 120,
      asked: 60,
      heldBy: null
    });
    expect(radios().map(radio => radio.checked)).toEqual(["true", "false", "false"]);
    expect(view.q("[data-rate-answer='ok']")?.textContent).toContain("✓Pinned at 60, adaptive off");
  });
});

describe("the cards", () => {
  it("a source with no frame yet shows 'Waiting for frames' over the cards, never a 0", () => {
    view.unmount();
    ctx = missionCtx({ device: true });
    view = mountRender(ctx);

    const fps = view.q("[data-card-kind='fps']");
    expect(fps?.querySelector("[data-off]")?.textContent).toBe("Waiting for framesfrom Galaxy A26");
    expect(fps?.querySelector("strong")?.textContent).toBe("—");
  });
});
