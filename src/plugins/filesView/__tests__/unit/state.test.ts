import { describe, expect, it } from "vitest";
import { createFilesViewState } from "../../state";

// ─────────────────────────────────────────────────────────────────────────────
// createFilesViewState: every field of the spec's FilesViewState, empty
// collections, undefined elsewhere, a fresh object per call.
// ─────────────────────────────────────────────────────────────────────────────

describe("createFilesViewState", () => {
  it("has exactly the fields of the spec's state", () => {
    expect(Object.keys(createFilesViewState()).toSorted()).toEqual(
      [
        "index",
        "indexing",
        "expanded",
        "tabs",
        "active",
        "graph",
        "confirmClose",
        "following",
        "listeners",
        "removers",
        "paletteRemover"
      ].toSorted()
    );
  });

  it("starts with empty collections and undefined elsewhere", () => {
    const state = createFilesViewState();
    expect(state.index).toBeUndefined();
    expect(state.indexing).toBeUndefined();
    expect(state.active).toBeUndefined();
    expect(state.graph).toBeUndefined();
    expect(state.following).toBeUndefined();
    expect(state.confirmClose).toBeUndefined();
    expect(state.paletteRemover).toBeUndefined();
    expect(state.expanded).toBeInstanceOf(Set);
    expect(state.expanded.size).toBe(0);
    expect(state.listeners).toBeInstanceOf(Set);
    expect(state.listeners.size).toBe(0);
    expect(state.tabs).toEqual([]);
    expect(state.removers).toEqual([]);
  });

  it("returns a fresh object with fresh collections on every call", () => {
    const first = createFilesViewState();
    const second = createFilesViewState();
    expect(second).not.toBe(first);
    expect(second.tabs).not.toBe(first.tabs);
    expect(second.expanded).not.toBe(first.expanded);
    expect(second.listeners).not.toBe(first.listeners);
    expect(second.removers).not.toBe(first.removers);
    first.tabs.push({} as never);
    first.expanded.add("flows");
    expect(second.tabs).toEqual([]);
    expect(second.expanded.size).toBe(0);
  });
});
