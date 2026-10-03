import { describe, expect, it } from "vitest";
import { createStateViewState } from "../../state";

describe("createStateViewState", () => {
  it("starts with no baseline, note none, seq 0 and empty collections", () => {
    const state = createStateViewState();
    expect(state).toEqual({
      baseline: undefined,
      last: undefined,
      note: "none",
      seq: 0,
      tainted: undefined,
      graph: undefined,
      session: undefined,
      expanded: new Map(),
      listeners: new Set(),
      stopModel: undefined,
      stopTainted: undefined,
      stopManifest: undefined
    });
  });

  it("gives every app its own maps", () => {
    expect(createStateViewState().expanded).not.toBe(createStateViewState().expanded);
    expect(createStateViewState().listeners).not.toBe(createStateViewState().listeners);
  });
});
