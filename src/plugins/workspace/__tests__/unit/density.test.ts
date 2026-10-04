// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chooseDensity } from "../../prefs/apply";
import { isDensityChoice, refreshDensity, resolveDensity, showDensity } from "../../prefs/density";
import { createCtx, type TestCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Density: auto resolves by window width, the choice persists, <html
// data-density> shows the applied value, workspace:density fires on a change
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;

beforeEach(() => {
  localStorage.clear();
  ctx = createCtx();
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete document.documentElement.dataset.density;
});

describe("resolveDensity", () => {
  it("auto is compact below 820 px of window width and comfortable from 820 px", () => {
    expect(resolveDensity("auto", 480)).toBe("compact");
    expect(resolveDensity("auto", 819)).toBe("compact");
    expect(resolveDensity("auto", 820)).toBe("comfortable");
    expect(resolveDensity("auto", 1440)).toBe("comfortable");
  });

  it("a fixed choice ignores the width", () => {
    expect(resolveDensity("compact", 1440)).toBe("compact");
    expect(resolveDensity("comfortable", 480)).toBe("comfortable");
  });
});

describe("isDensityChoice", () => {
  it("accepts the three choices only", () => {
    expect(["auto", "compact", "comfortable"].every(value => isDensityChoice(value))).toBe(true);
    expect(isDensityChoice("cosy")).toBe(false);
    expect(isDensityChoice(undefined)).toBe(false);
  });
});

describe("showDensity", () => {
  it("writes the applied value on <html>", () => {
    ctx.state.density = { chosen: "auto", applied: "compact" };
    showDensity(ctx.state);
    expect(document.documentElement.dataset.density).toBe("compact");
  });
});

describe("chooseDensity", () => {
  it("rejects an unknown value with a [moku-editor] error", () => {
    // @ts-expect-error — not a DensityChoice
    expect(() => chooseDensity(ctx, "cosy")).toThrow(/^\[moku-editor\] Unknown density "cosy"\./);
  });

  it("applies and persists the choice and emits workspace:density when the value changes", () => {
    vi.stubGlobal("innerWidth", 1440);
    ctx.state.density = { chosen: "auto", applied: "comfortable" };
    const version = ctx.state.ui.version;

    chooseDensity(ctx, "compact");
    expect(ctx.state.density).toEqual({ chosen: "compact", applied: "compact" });
    expect(document.documentElement.dataset.density).toBe("compact");
    expect(ctx.emit).toHaveBeenCalledWith("workspace:density", { density: "compact" });
    expect(ctx.state.ui.version).toBeGreaterThan(version);
    expect(JSON.parse(localStorage.getItem("moku-editor-test") ?? "{}").density).toBe("compact");
  });

  it("a choice that resolves to the shown value persists without an event", () => {
    vi.stubGlobal("innerWidth", 1440);
    ctx.state.density = { chosen: "auto", applied: "comfortable" };
    chooseDensity(ctx, "comfortable");
    expect(ctx.state.density.chosen).toBe("comfortable");
    expect(ctx.emit).not.toHaveBeenCalled();
    expect(JSON.parse(localStorage.getItem("moku-editor-test") ?? "{}").density).toBe(
      "comfortable"
    );
  });
});

describe("refreshDensity", () => {
  it("auto follows the window width; the event fires once per change", () => {
    ctx.state.density = { chosen: "auto", applied: "comfortable" };
    vi.stubGlobal("innerWidth", 720);
    refreshDensity(ctx);
    refreshDensity(ctx);
    expect(ctx.state.density.applied).toBe("compact");
    expect(ctx.emit).toHaveBeenCalledTimes(1);
    expect(ctx.emit).toHaveBeenCalledWith("workspace:density", { density: "compact" });

    vi.stubGlobal("innerWidth", 1200);
    refreshDensity(ctx);
    expect(ctx.state.density.applied).toBe("comfortable");
    expect(document.documentElement.dataset.density).toBe("comfortable");
    expect(ctx.emit).toHaveBeenCalledTimes(2);
  });

  it("a fixed choice stays on resize", () => {
    ctx.state.density = { chosen: "comfortable", applied: "comfortable" };
    vi.stubGlobal("innerWidth", 480);
    refreshDensity(ctx);
    expect(ctx.state.density.applied).toBe("comfortable");
    expect(ctx.emit).not.toHaveBeenCalled();
  });
});
