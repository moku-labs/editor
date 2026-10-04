// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  clampWidth,
  showSidePanel,
  sidePanelState,
  subscribeSidePanel,
  toggleSidePanel,
  updateSidePanel
} from "../../shared/side-panel/store";

// ─────────────────────────────────────────────────────────────────────────────
// The SidePanel store (D-29): per panel { width, collapsed, closed } in
// localStorage under moku-editor:panel:<id>, every access in try/catch, plus the
// session part (overlay mode and the drawer) that is never stored. Each test
// uses its own panel id: the store keeps a memory copy while storage fails.
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULTS = {
  width: undefined,
  collapsed: false,
  closed: false,
  overlay: false,
  drawer: false
};

/** The stored record of a panel, parsed. */
function stored(id: string): unknown {
  const text = localStorage.getItem(`moku-editor:panel:${id}`);
  return text === null ? undefined : JSON.parse(text);
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("clampWidth", () => {
  it("keeps a width inside [min, max] and clamps one outside", () => {
    expect(clampWidth(300, 220, 560)).toBe(300);
    expect(clampWidth(100, 220, 560)).toBe(220);
    expect(clampWidth(900, 220, 560)).toBe(560);
  });

  it("gives min for a width that is not a finite number", () => {
    expect(clampWidth(Number.NaN, 220, 560)).toBe(220);
  });
});

describe("sidePanelState and updateSidePanel", () => {
  it("gives the defaults for a panel never seen", () => {
    expect(sidePanelState("test.fresh")).toEqual(DEFAULTS);
  });

  it("stores width, collapsed and closed under moku-editor:panel:<id>, never the session part", () => {
    updateSidePanel("test.write", { width: 400, collapsed: true, overlay: true, drawer: true });

    expect(stored("test.write")).toEqual({ width: 400, collapsed: true, closed: false });
    expect(sidePanelState("test.write")).toEqual({
      width: 400,
      collapsed: true,
      closed: false,
      overlay: true,
      drawer: true
    });
  });

  it("drops the width from the record when it goes back to the default", () => {
    updateSidePanel("test.reset", { width: 400 });
    updateSidePanel("test.reset", { width: undefined });

    expect(stored("test.reset")).toEqual({ collapsed: false, closed: false });
    expect(sidePanelState("test.reset").width).toBeUndefined();
  });

  it("reads a record saved before", () => {
    localStorage.setItem(
      "moku-editor:panel:test.saved",
      JSON.stringify({ width: 380, collapsed: false, closed: true })
    );

    expect(sidePanelState("test.saved")).toEqual({ ...DEFAULTS, width: 380, closed: true });
  });

  it("reads a broken record as the defaults, field by field", () => {
    localStorage.setItem("moku-editor:panel:test.garbage", "{not json");
    localStorage.setItem(
      "moku-editor:panel:test.fields",
      JSON.stringify({ width: "wide", collapsed: "yes", closed: true })
    );
    localStorage.setItem("moku-editor:panel:test.negative", JSON.stringify({ width: -5 }));
    localStorage.setItem("moku-editor:panel:test.array", "[1,2]");

    expect(sidePanelState("test.garbage")).toEqual(DEFAULTS);
    expect(sidePanelState("test.fields")).toEqual({ ...DEFAULTS, closed: true });
    expect(sidePanelState("test.negative")).toEqual(DEFAULTS);
    expect(sidePanelState("test.array")).toEqual(DEFAULTS);
  });

  it("keeps working in memory when storage throws on every access", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("denied");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("denied");
    });

    expect(sidePanelState("test.throws")).toEqual(DEFAULTS);
    expect(() => updateSidePanel("test.throws", { width: 300, closed: true })).not.toThrow();
    expect(sidePanelState("test.throws")).toEqual({ ...DEFAULTS, width: 300, closed: true });
  });

  it("keeps the newer value in memory when only the write fails (storage full)", () => {
    localStorage.setItem("moku-editor:panel:test.full", JSON.stringify({ width: 300 }));
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });

    updateSidePanel("test.full", { width: 450 });

    expect(sidePanelState("test.full").width).toBe(450);
  });

  it("works without localStorage at all", () => {
    vi.stubGlobal("localStorage", undefined);

    updateSidePanel("test.none", { collapsed: true });

    expect(sidePanelState("test.none")).toEqual({ ...DEFAULTS, collapsed: true });
  });
});

describe("subscribeSidePanel", () => {
  it("tells the listeners of that panel only, until they unsubscribe", () => {
    const listener = vi.fn();
    const other = vi.fn();
    const stop = subscribeSidePanel("test.sub", listener);
    subscribeSidePanel("test.other", other);

    updateSidePanel("test.sub", { collapsed: true });
    stop();
    updateSidePanel("test.sub", { collapsed: false });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(other).not.toHaveBeenCalled();
  });
});

describe("showSidePanel and toggleSidePanel", () => {
  it("shows a closed, collapsed docked panel expanded", () => {
    updateSidePanel("test.show", { closed: true, collapsed: true });

    showSidePanel("test.show");

    expect(sidePanelState("test.show")).toMatchObject({ closed: false, collapsed: false });
  });

  it("shows a panel in overlay mode with its drawer open, keeping the docked choice", () => {
    updateSidePanel("test.showOverlay", { closed: true, collapsed: true, overlay: true });

    showSidePanel("test.showOverlay");

    expect(sidePanelState("test.showOverlay")).toMatchObject({
      closed: false,
      collapsed: true,
      drawer: true
    });
  });

  it("toggles collapsed when docked and the drawer in overlay mode", () => {
    toggleSidePanel("test.toggle");
    expect(sidePanelState("test.toggle").collapsed).toBe(true);
    toggleSidePanel("test.toggle");
    expect(sidePanelState("test.toggle").collapsed).toBe(false);

    updateSidePanel("test.toggle", { overlay: true });
    toggleSidePanel("test.toggle");
    expect(sidePanelState("test.toggle")).toMatchObject({ collapsed: false, drawer: true });
  });

  it("shows a closed panel on toggle", () => {
    updateSidePanel("test.toggleClosed", { closed: true });

    toggleSidePanel("test.toggleClosed");

    expect(sidePanelState("test.toggleClosed")).toMatchObject({ closed: false, collapsed: false });
  });
});
