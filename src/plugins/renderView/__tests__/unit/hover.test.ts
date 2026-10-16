import { describe, expect, it, vi } from "vitest";
import { createRenderViewState } from "../../state";
import { hoverFrame, onHoverFrame, onHoverMove, setHover } from "../../view/hover";
import { CONFIG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// view/hover.ts (spec 09 § M8 item 12, tooltip): the shared cursor. The source
// time under the pointer goes into mission.hoverMs for the painters; the DOM
// (tooltip, cards' cursor chips) hears only a change of the hovered frame, the
// paint loop hears every move.
// ─────────────────────────────────────────────────────────────────────────────

function mission() {
  return createRenderViewState({ config: CONFIG }).mission;
}

describe("the shared cursor", () => {
  it("tells the frame listeners only when the hovered frame changes, not on every pointer move", () => {
    const state = mission();
    const frames = vi.fn();
    const moves = vi.fn();
    onHoverFrame(state, frames);
    onHoverMove(state, moves);

    setHover(state, 1000, 4851);
    setHover(state, 1003, 4851);
    setHover(state, 1009, 4852);

    expect(frames).toHaveBeenCalledTimes(2);
    expect(moves).toHaveBeenCalledTimes(3);
    expect(state.hoverMs).toBe(1009);
    expect(hoverFrame(state)).toBe(4852);
  });

  it("leaving the graphs clears the cursor the painters read and tells the frame listeners once", () => {
    const state = mission();
    const frames = vi.fn();
    setHover(state, 1000, 4851);
    const off = onHoverFrame(state, frames);

    setHover(state, undefined, undefined);
    setHover(state, undefined, undefined);

    expect(state.hoverMs).toBeUndefined();
    expect(hoverFrame(state)).toBeUndefined();
    expect(frames).toHaveBeenCalledTimes(1);
    off();
    setHover(state, 2000, 4900);
    expect(frames).toHaveBeenCalledTimes(1);
  });
});
