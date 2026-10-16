// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeOverlay, openOverlay, setTab, toggleOverlay } from "../../modes";
import { HOST_ATTRIBUTE, PAINT_MS, STORE_KEY } from "../../types";
import {
  bracketMonitor,
  changes,
  command,
  createOctx,
  started,
  stopped,
  type TestOctx
} from "../helpers";

let octx: TestOctx;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setInterval", "clearInterval", "Date"] });
  localStorage.clear();
});

afterEach(() => {
  stopped(octx);
  vi.useRealTimers();
  localStorage.clear();
});

/**
 * The overlay's host in the document.
 *
 * @returns The host.
 */
function host(): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[${HOST_ATTRIBUTE}]`);
  if (element === null) throw new Error("no host");
  return element;
}

describe("modes", () => {
  it("open() opens the pill (it opens the card)", () => {
    octx = started(createOctx());
    openOverlay(octx);
    expect(octx.state.mode).toBe("card");
    expect(host().dataset.mode).toBe("card");
    expect(host().hidden).toBe(false);
  });

  it("toggle from hidden opens the pill after the card was last used (it opens the card)", () => {
    octx = started(createOctx());
    openOverlay(octx, { mode: "pill" });
    openOverlay(octx);
    closeOverlay(octx);
    toggleOverlay(octx);
    expect(octx.state.mode).toBe("card");
    openOverlay(octx, { mode: "pill" });
    toggleOverlay(octx);
    expect(octx.state.mode).toBe("hidden");
    toggleOverlay(octx);
    expect(octx.state.mode).toBe("pill");
  });

  it("close() from hidden emits (it does not)", () => {
    octx = started(createOctx());
    closeOverlay(octx);
    expect(changes(octx)).toEqual([]);
    openOverlay(octx);
    closeOverlay(octx);
    closeOverlay(octx);
    expect(changes(octx)).toEqual([
      { mode: "card", tab: "frames" },
      { mode: "hidden", tab: "frames" }
    ]);
  });

  it("a tab change emits nothing (it emits overlay:changed and writes the store)", () => {
    octx = started(createOctx());
    openOverlay(octx);
    setTab(octx, "record");
    expect(changes(octx).at(-1)).toEqual({ mode: "card", tab: "record" });
    expect(JSON.parse(localStorage.getItem(STORE_KEY) ?? "{}")).toMatchObject({ tab: "record" });
    setTab(octx, "record");
    expect(changes(octx)).toHaveLength(2);
  });

  it("the game tab falls back to frames without overlay commands", () => {
    octx = started(createOctx());
    openOverlay(octx, { tab: "game" });
    expect(octx.state.tab).toBe("frames");
    const withGame = started(createOctx({}, [command("garden.glow", { overlay: "toggle" })]));
    openOverlay(withGame, { tab: "game" });
    expect(withGame.state.tab).toBe("game");
    stopped(withGame);
  });

  it("a tab change slides the card (only a change into a visible mode slides)", () => {
    octx = started(createOctx());
    openOverlay(octx);
    expect(host().dataset.opening !== undefined).toBe(true);
    vi.advanceTimersByTime(PAINT_MS);
    expect(host().dataset.opening !== undefined).toBe(false);
    setTab(octx, "link");
    expect(host().dataset.opening !== undefined).toBe(false);
    openOverlay(octx, { mode: "pill" });
    expect(host().dataset.opening !== undefined).toBe(true);
  });

  it("the slide never clears under reduced motion (cleared at the next tick, or animationend)", () => {
    octx = started(createOctx());
    openOverlay(octx);
    expect(octx.state.opening).toBe(true);
    octx.state.root?.dispatchEvent(new Event("animationend"));
    expect(host().dataset.opening !== undefined).toBe(false);
    closeOverlay(octx);
    openOverlay(octx);
    vi.advanceTimersByTime(PAINT_MS);
    expect(octx.state.opening).toBe(false);
  });

  it("hidden keeps the interval running (no interval, no canvas, host hidden)", () => {
    octx = started(createOctx());
    openOverlay(octx);
    expect(vi.getTimerCount()).toBe(1);
    expect(octx.state.root?.querySelector("canvas")).not.toBeNull();
    closeOverlay(octx);
    expect(vi.getTimerCount()).toBe(0);
    expect(host().hidden).toBe(true);
    expect(octx.state.root?.querySelector("canvas")).toBeNull();
    expect(octx.state.root?.querySelector("[data-overlay]")).toBeNull();
  });

  it("open before start is lost behind the remembered mode (the asked mode wins)", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        v: 1,
        mode: "pill",
        last: "pill",
        tab: "record",
        place: { dock: "left", y: 0 }
      })
    );
    octx = createOctx();
    openOverlay(octx);
    expect(octx.state.mode).toBe("card");
    expect(changes(octx)).toEqual([]);
    started(octx);
    expect(octx.state).toMatchObject({
      mode: "card",
      tab: "record",
      place: { dock: "left", y: 0 }
    });
    expect(changes(octx)).toEqual([{ mode: "card", tab: "record" }]);
  });

  it("starts in the remembered mode, else config.mode, and emits once when visible", () => {
    localStorage.setItem(
      STORE_KEY,
      JSON.stringify({
        v: 1,
        mode: "pill",
        last: "pill",
        tab: "link",
        place: { dock: "right", y: 0.5 }
      })
    );
    octx = started(createOctx());
    expect(octx.state.mode).toBe("pill");
    expect(changes(octx)).toEqual([{ mode: "pill", tab: "link" }]);
    stopped(octx);
    octx = started(createOctx({ mode: "card", remember: false }));
    expect(octx.state.mode).toBe("card");
    expect(octx.state.tab).toBe("frames");
  });

  it("no unbracketed work on a mode change (viewport, insets and layout inside the agent span)", () => {
    octx = createOctx({ remember: false });
    const monitor = bracketMonitor();
    octx.perf.monitorValue = monitor;
    started(octx);
    const second = octx.perf.second;
    octx.perf.second = () => {
      monitor.calls.push("second");
      return second();
    };
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => {
      monitor.calls.push("style");
      return { width: "0px", height: "0px" } as CSSStyleDeclaration;
    });
    const style = octx.state.host?.style;
    if (style === undefined) throw new Error("no host");
    const setProperty = style.setProperty.bind(style);
    vi.spyOn(style, "setProperty").mockImplementation((...args) => {
      monitor.calls.push("layout");
      setProperty(...args);
    });
    monitor.calls.length = 0;
    openOverlay(octx, { mode: "pill" });
    openOverlay(octx);
    expect(monitor.calls).toContain("style");
    expect(monitor.calls).toContain("layout");
    let depth = 0;
    for (const call of monitor.calls) {
      if (call === "begin") depth += 1;
      else if (call === "end") depth -= 1;
      else expect(depth, call).toBeGreaterThan(0);
    }
    vi.restoreAllMocks();
  });
});
