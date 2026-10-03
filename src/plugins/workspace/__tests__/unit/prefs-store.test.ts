// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultStoredPrefs, loadPrefs, savePrefs } from "../../prefs/store";
import type { StoredPrefs } from "../../types";
import { createLog } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The versioned localStorage record: round trip, bad data, throwing storage
// ─────────────────────────────────────────────────────────────────────────────

const KEY = "moku-editor-prefs-test";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("defaultStoredPrefs", () => {
  it("has no chosen theme, S bottom-right previews and the iPhone 15 portrait", () => {
    const prefs = defaultStoredPrefs();
    expect(prefs.theme).toBeUndefined();
    expect(Object.keys(prefs.previews)).toEqual(["flow", "render", "state", "files", "console"]);
    expect(prefs.previews.flow).toEqual({ visible: true, size: "S", corner: "bottom-right" });
    expect(prefs.device).toEqual({ preset: "iphone-15", orientation: "portrait" });
  });
});

describe("loadPrefs / savePrefs", () => {
  it("round-trips a record under the key with v: 1", () => {
    const log = createLog();
    const prefs: StoredPrefs = {
      ...defaultStoredPrefs(),
      theme: "dark",
      device: { preset: "pixel-8", orientation: "landscape" }
    };
    prefs.previews.render = { visible: false, size: "L", corner: "top-left" };

    savePrefs(KEY, prefs, log);
    expect(JSON.parse(localStorage.getItem(KEY) ?? "{}")).toMatchObject({ v: 1, theme: "dark" });
    expect(loadPrefs(KEY, log)).toEqual(prefs);
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("without a record answers the defaults silently", () => {
    const log = createLog();
    expect(loadPrefs(KEY, log)).toEqual(defaultStoredPrefs());
    expect(log.warn).not.toHaveBeenCalled();
  });

  it("corrupt JSON → defaults and one warn", () => {
    const log = createLog();
    localStorage.setItem(KEY, "{nope");
    expect(loadPrefs(KEY, log)).toEqual(defaultStoredPrefs());
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("workspace:prefs", expect.anything());
  });

  it("another version → defaults and one warn", () => {
    const log = createLog();
    localStorage.setItem(KEY, JSON.stringify({ v: 2, theme: "dark" }));
    expect(loadPrefs(KEY, log)).toEqual(defaultStoredPrefs());
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("a record that is not an object → defaults and one warn", () => {
    const log = createLog();
    localStorage.setItem(KEY, "[1,2]");
    expect(loadPrefs(KEY, log)).toEqual(defaultStoredPrefs());
    expect(log.warn).toHaveBeenCalledTimes(1);
  });

  it("unknown values fall back field by field with one warn naming them", () => {
    const log = createLog();
    localStorage.setItem(
      KEY,
      JSON.stringify({
        v: 1,
        theme: "sepia",
        previews: {
          flow: { visible: false, size: "M", corner: "top-right" },
          render: { visible: "yes", size: "S", corner: "bottom-right" },
          files: "x"
        },
        device: { preset: "nokia", orientation: "landscape" }
      })
    );

    const prefs = loadPrefs(KEY, log);
    expect(prefs.theme).toBeUndefined();
    expect(prefs.previews.flow).toEqual({ visible: false, size: "M", corner: "top-right" });
    expect(prefs.previews.render).toEqual(defaultStoredPrefs().previews.render);
    expect(prefs.previews.files).toEqual(defaultStoredPrefs().previews.files);
    expect(prefs.device).toEqual({ preset: "iphone-15", orientation: "landscape" });
    expect(log.warn).toHaveBeenCalledTimes(1);
    expect(log.warn).toHaveBeenCalledWith("workspace:prefs", {
      invalid: ["theme", "previews.render", "previews.files", "device.preset"]
    });
  });

  it("a bad orientation and missing previews fall back too", () => {
    const log = createLog();
    localStorage.setItem(KEY, JSON.stringify({ v: 1, device: { orientation: "upside" } }));
    const prefs = loadPrefs(KEY, log);
    expect(prefs.device).toEqual({ preset: "iphone-15", orientation: "portrait" });
    expect(prefs.previews).toEqual(defaultStoredPrefs().previews);
    expect(log.warn).toHaveBeenCalledWith("workspace:prefs", {
      invalid: ["previews", "device.preset", "device.orientation"]
    });
  });

  it("a throwing getItem → defaults and one warn", () => {
    const log = createLog();
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("denied");
      }
    });
    expect(loadPrefs(KEY, log)).toEqual(defaultStoredPrefs());
    expect(log.warn).toHaveBeenCalledWith("workspace:prefs", { op: "load", message: "denied" });
  });

  it("a throwing setItem (quota) logs one warn and does not throw", () => {
    const log = createLog();
    vi.stubGlobal("localStorage", {
      setItem: () => {
        throw new Error("quota");
      }
    });
    expect(() => savePrefs(KEY, defaultStoredPrefs(), log)).not.toThrow();
    expect(log.warn).toHaveBeenCalledWith("workspace:prefs", { op: "save", message: "quota" });
  });

  it("without localStorage loads the defaults and saves nothing", () => {
    const log = createLog();
    vi.stubGlobal("localStorage", undefined);
    expect(loadPrefs(KEY, log)).toEqual(defaultStoredPrefs());
    expect(() => savePrefs(KEY, defaultStoredPrefs(), log)).not.toThrow();
    expect(log.warn).not.toHaveBeenCalled();
  });
});
