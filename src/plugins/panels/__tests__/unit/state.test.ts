import { describe, expect, it } from "vitest";
import { createPanelsState } from "../../state";

// ─────────────────────────────────────────────────────────────────────────────
// createPanelsState: nothing registered, nothing mounted, status connecting.
// ─────────────────────────────────────────────────────────────────────────────

describe("createPanelsState", () => {
  it("starts empty, not started, connecting", () => {
    const state = createPanelsState({ config: {} });
    expect(state.panels).toEqual([]);
    expect(state.ids.size).toBe(0);
    expect(state.mounted.size).toBe(0);
    expect(state.status).toEqual({ kind: "connecting" });
    expect(state.started).toBe(false);
    expect(state.cleanup).toEqual([]);
  });

  it("returns a fresh state on every call", () => {
    const first = createPanelsState({ config: {} });
    const second = createPanelsState({ config: {} });
    first.panels.push({} as never);
    expect(second.panels).toEqual([]);
    expect(first.mounted).not.toBe(second.mounted);
  });
});
