import { describe, expect, it, vi } from "vitest";
import { createGameViewState, notify, subscribe } from "../../state";

describe("createGameViewState", () => {
  it("starts on the Element tab, fit, safe area on, picker off, nothing read", () => {
    const state = createGameViewState();
    expect(state).toMatchObject({
      tab: "element",
      zoom: "fit",
      safeArea: true,
      picker: { on: false, hover: undefined },
      selected: undefined,
      treeHover: undefined,
      sources: {},
      watching: [],
      scene: undefined,
      calibration: undefined,
      manifest: undefined,
      card: undefined,
      series: {
        popover: false,
        durationMs: 2000,
        intervalMs: 100,
        recording: undefined,
        sheet: undefined
      },
      styles: undefined,
      overlayRoot: undefined,
      timers: {},
      disposers: [],
      link: { status: undefined, session: undefined },
      calibrationRead: false,
      lookup: undefined,
      cardHeld: false,
      reloading: false,
      highlightSeq: 0
    });
    expect(state.listeners.size).toBe(0);
  });

  it("starts without pick bookmarks, a last pick, searches or found style blocks", () => {
    const state = createGameViewState();
    expect(state.bookmarks).toEqual([]);
    expect(state.pick).toBeUndefined();
    expect(state.searches.size).toBe(0);
    expect(state.blocks.size).toBe(0);
  });

  it("gives every app its own state", () => {
    expect(createGameViewState().watching).not.toBe(createGameViewState().watching);
  });
});

describe("notify and subscribe", () => {
  it("calls every listener; the remover is idempotent", () => {
    const state = createGameViewState();
    const first = vi.fn();
    const second = vi.fn();
    const off = subscribe(state, first);
    subscribe(state, second);

    notify(state);
    off();
    off();
    notify(state);

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(2);
  });

  it("lets a listener unsubscribe while notified", () => {
    const state = createGameViewState();
    const later = vi.fn();
    const off = subscribe(state, () => off());
    subscribe(state, later);

    notify(state);

    expect(later).toHaveBeenCalledTimes(1);
    expect(state.listeners.size).toBe(1);
  });
});
