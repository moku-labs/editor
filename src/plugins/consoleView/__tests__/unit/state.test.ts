import { describe, expect, it, vi } from "vitest";
import { createConsoleState, notify, subscribe } from "../../state";
import { CONFIG } from "../helpers";

describe("createConsoleState", () => {
  it("starts empty, with nextKey 1, level all and preserve from config", () => {
    const state = createConsoleState({ config: CONFIG });
    expect(state).toEqual({
      lines: [],
      nextKey: 1,
      instance: undefined,
      consumed: 0,
      preserve: false,
      level: "all",
      query: "",
      selected: undefined,
      everConnected: false,
      listeners: new Set(),
      stopLog: undefined,
      removePalette: [],
      searchEl: undefined
    });
    expect(createConsoleState({ config: { ...CONFIG, preserveLog: true } }).preserve).toBe(true);
  });

  it("returns a fresh state each time", () => {
    const first = createConsoleState({ config: CONFIG });
    const second = createConsoleState({ config: CONFIG });
    expect(first.lines).not.toBe(second.lines);
    expect(first.listeners).not.toBe(second.listeners);
  });
});

describe("notify and subscribe", () => {
  it("calls every listener until it is removed; removal is idempotent", () => {
    const state = createConsoleState({ config: CONFIG });
    const listener = vi.fn();
    const off = subscribe(state, listener);
    notify(state);
    expect(listener).toHaveBeenCalledTimes(1);
    off();
    off();
    notify(state);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(state.listeners.size).toBe(0);
  });
});
