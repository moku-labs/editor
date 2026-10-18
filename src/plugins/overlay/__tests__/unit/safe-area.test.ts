// @vitest-environment happy-dom
/* eslint-disable unicorn/no-null -- null is the engine's and perf's "not measured" */
import { afterEach, describe, expect, it, vi } from "vitest";
import { openOverlay } from "../../modes";
import { bracketMonitor, createOctx, secondOf, started, stopped, type TestOctx } from "../helpers";

let octx: TestOctx | undefined;

afterEach(() => {
  if (octx !== undefined) stopped(octx);
  octx = undefined;
  vi.restoreAllMocks();
  localStorage.clear();
});

/**
 * Makes the two probes report sizes (CSS text, as getComputedStyle answers).
 *
 * @param start - Width (left) and height (top) of the start probe.
 * @param end - Width (right) and height (bottom) of the end probe.
 */
function probes(start: readonly [string, string], end: readonly [string, string]) {
  return vi.spyOn(globalThis, "getComputedStyle").mockImplementation(element => {
    const [width, height] = (element as HTMLElement).dataset.safeProbe === "start" ? start : end;
    return { width, height } as CSSStyleDeclaration;
  });
}

/**
 * A started context with perf's display insets (null for none).
 *
 * @param safeArea - perf's display safe area.
 * @returns The context.
 */
function start(safeArea: { t: number; r: number; b: number; l: number } | null): TestOctx {
  const made = createOctx({ remember: false });
  made.perf.secondValue =
    safeArea === null
      ? secondOf({ display: null })
      : secondOf({
          display: {
            ...(secondOf().display as NonNullable<ReturnType<typeof secondOf>["display"]>),
            safeArea
          }
        });
  octx = started(made);
  return made;
}

describe("the safe area", () => {
  it("an unparsable probe value breaks the layout (it reads 0)", () => {
    probes(["auto", ""], ["none", "-"]);
    const made = start(null);
    expect(made.state.insets).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  it("perf's larger display inset is ignored (the larger of probe and perf wins per side)", () => {
    probes(["12px", "20px"], ["0px", "10px"]);
    const made = start({ t: 32, r: 0, b: 24, l: 0 });
    expect(made.state.insets).toEqual({ top: 32, right: 0, bottom: 24, left: 12 });
  });

  it("a `moku-native:insets` event does not re-measure (it re-reads and lays out)", () => {
    probes(["0px", "0px"], ["0px", "0px"]);
    const made = start(null);
    made.state.place = { dock: "right", y: 0 };
    openOverlay(made);
    expect(made.state.host?.style.getPropertyValue("--overlay-top")).toBe("8px");
    probes(["0px", "40px"], ["0px", "0px"]);
    globalThis.dispatchEvent(new Event("moku-native:insets"));
    expect(made.state.insets.top).toBe(40);
    expect(made.state.host?.style.getPropertyValue("--overlay-top")).toBe("48px");
  });

  it("re-reads the viewport on resize", () => {
    probes(["0px", "0px"], ["0px", "0px"]);
    const made = start(null);
    openOverlay(made);
    Object.defineProperty(globalThis, "innerWidth", { configurable: true, value: 360 });
    globalThis.dispatchEvent(new Event("resize"));
    Reflect.deleteProperty(globalThis, "innerWidth");
    expect(made.state.viewport.w).toBe(360);
    expect(made.state.host?.style.getPropertyValue("--overlay-w")).toBe("300px");
    expect(
      made.state.root?.querySelector<HTMLElement>("[data-overlay]")?.dataset.compact !== undefined
    ).toBe(true);
  });

  it("stops listening on stop", () => {
    probes(["0px", "0px"], ["0px", "0px"]);
    const made = start(null);
    stopped(made);
    octx = undefined;
    probes(["0px", "40px"], ["0px", "0px"]);
    globalThis.dispatchEvent(new Event("moku-native:insets"));
    expect(made.state.insets.top).toBe(0);
  });

  it("does no work on resize or insets while hidden; the next visible mode re-reads", () => {
    probes(["0px", "0px"], ["0px", "0px"]);
    const made = start(null);
    const reads = probes(["0px", "40px"], ["0px", "0px"]);
    reads.mockClear();
    const second = vi.spyOn(made.perf, "second");
    globalThis.dispatchEvent(new Event("resize"));
    globalThis.dispatchEvent(new Event("moku-native:insets"));
    expect(reads).not.toHaveBeenCalled();
    expect(second).not.toHaveBeenCalled();
    expect(made.state.insets.top).toBe(0);
    openOverlay(made);
    expect(made.state.insets.top).toBe(40);
  });

  it("reads and lays out inside the agent span on a resize while visible", () => {
    probes(["0px", "0px"], ["0px", "0px"]);
    const made = start(null);
    const monitor = bracketMonitor();
    made.perf.monitorValue = monitor;
    openOverlay(made);
    vi.spyOn(globalThis, "getComputedStyle").mockImplementation(() => {
      monitor.calls.push("style");
      return { width: "0px", height: "0px" } as CSSStyleDeclaration;
    });
    monitor.calls.length = 0;
    globalThis.dispatchEvent(new Event("resize"));
    expect(monitor.calls.slice(0, 3)).toEqual(["begin", "style", "style"]);
    expect(monitor.calls.filter(call => call === "begin")).toHaveLength(
      monitor.calls.filter(call => call === "end").length
    );
  });
});
