import { describe, expect, it } from "vitest";
import { createRenderViewState } from "../../state";
import { CONFIG } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// state.ts: the state factory — the initial shape, including session,
// calibrationAsked and palette, and a fresh object with fresh collections per call.
// ─────────────────────────────────────────────────────────────────────────────

describe("createRenderViewState", () => {
  it("starts empty: no data, sort GPU MB descending, every bundle, nothing open", () => {
    const state = createRenderViewState({ config: CONFIG });

    expect(state).toEqual({
      active: false,
      session: undefined,
      lastFrame: undefined,
      firstFrame: undefined,
      render: undefined,
      assets: undefined,
      effectsInstalled: true,
      sources: {},
      scene: undefined,
      calibration: undefined,
      calibrationAsked: false,
      catalogue: undefined,
      fps: [],
      loaded: new Map(),
      releases: [],
      seen: new Map(),
      tree: { open: new Set(), selected: undefined },
      table: { sort: "gpuMb", dir: -1, bundle: "all", hover: undefined },
      pendingReveal: undefined,
      box: undefined,
      overlayRoot: undefined,
      error: undefined,
      palette: undefined,
      tracker: [],
      watching: [],
      listeners: new Set()
    });
  });

  it("has the three fields the hooks need: session, calibrationAsked, palette", () => {
    const state = createRenderViewState({ config: CONFIG });

    expect(state).toHaveProperty("session", undefined);
    expect(state).toHaveProperty("calibrationAsked", false);
    expect(state).toHaveProperty("palette", undefined);
  });

  it("returns a fresh object with fresh collections on every call", () => {
    const first = createRenderViewState({ config: CONFIG });
    const second = createRenderViewState({ config: CONFIG });

    expect(second).not.toBe(first);
    expect(second.sources).not.toBe(first.sources);
    expect(second.fps).not.toBe(first.fps);
    expect(second.loaded).not.toBe(first.loaded);
    expect(second.releases).not.toBe(first.releases);
    expect(second.seen).not.toBe(first.seen);
    expect(second.tree).not.toBe(first.tree);
    expect(second.tree.open).not.toBe(first.tree.open);
    expect(second.table).not.toBe(first.table);
    expect(second.tracker).not.toBe(first.tracker);
    expect(second.watching).not.toBe(first.watching);
    expect(second.listeners).not.toBe(first.listeners);

    first.fps.push(60);
    first.tree.open.add("ui:boardScreen");
    first.table.bundle = "ui";
    expect(second.fps).toEqual([]);
    expect(second.tree.open.size).toBe(0);
    expect(second.table.bundle).toBe("all");
  });
});
