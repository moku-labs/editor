// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createConsoleApi } from "../../api";
import { startConsole } from "../../lifecycle";
import type { ConsoleApi } from "../../types";
import { keepPreviewInLogArea, useConsole } from "../../view/useConsole";
import { createCtx, type TestCtx, traceValue } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// useConsole subscribes before the browser paints: a change the api reports
// right after the first render must reach the component.
// ─────────────────────────────────────────────────────────────────────────────

let ctx: TestCtx;
let api: ConsoleApi;
let host: HTMLElement;

/**
 * Shows the number of lines the console holds.
 *
 * @param props - Props.
 * @param props.api - The console api.
 * @returns The count as text.
 */
function LineCount(props: { readonly api: ConsoleApi }) {
  const count = useConsole(props.api, () => props.api.lines().length);
  return <output>{count}</output>;
}

beforeEach(() => {
  ctx = createCtx();
  api = createConsoleApi(ctx);
  host = document.createElement("div");
  document.body.append(host);
  startConsole(ctx);
});

afterEach(() => {
  act(() => {
    render(undefined, host);
  });
  host.remove();
});

describe("useConsole", () => {
  it("re-renders on a change reported before the effects of the first render ran", () => {
    act(() => {
      render(<LineCount api={api} />, host);
      ctx.link.send("game.log", traceValue());
    });
    expect(host.textContent).toBe("8");
  });

  it("re-renders on every later change and stops after unmount", () => {
    act(() => {
      render(<LineCount api={api} />, host);
    });
    act(() => {
      ctx.link.send("game.log", traceValue());
    });
    expect(host.textContent).toBe("8");

    act(() => {
      render(undefined, host);
    });
    expect(ctx.state.listeners.size).toBe(0);
  });
});

describe("keepPreviewInLogArea", () => {
  /** A ResizeObserver stand-in whose callback the test fires. */
  class FakeObserver {
    static readonly made: FakeObserver[] = [];
    readonly observed: Element[] = [];
    disconnected = false;
    constructor(readonly fire: () => void) {
      FakeObserver.made.push(this);
    }
    observe(element: Element): void {
      this.observed.push(element);
    }
    disconnect(): void {
      this.disconnected = true;
    }
  }

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeObserver.made.length = 0;
  });

  it("registers the log area as the console preview zone and removes it on stop", () => {
    const remove = vi.fn();
    const previewZone = vi.fn(() => remove);
    const area = document.createElement("div");
    vi.stubGlobal("ResizeObserver", undefined);

    const stop = keepPreviewInLogArea({ previewZone }, area);
    expect(previewZone).toHaveBeenCalledWith("console", area);
    stop();
    expect(remove).toHaveBeenCalledTimes(1);
  });

  it("registers the zone again on every resize (the drawer opens), dropping the old one", () => {
    const removers = [vi.fn(), vi.fn()];
    let call = 0;
    const previewZone = vi.fn(() => removers[call++] ?? vi.fn());
    const area = document.createElement("div");
    vi.stubGlobal("ResizeObserver", FakeObserver);

    const stop = keepPreviewInLogArea({ previewZone }, area);
    expect(FakeObserver.made[0]?.observed).toEqual([area]);
    FakeObserver.made[0]?.fire();
    expect(previewZone).toHaveBeenCalledTimes(2);
    expect(removers[0]).toHaveBeenCalledTimes(1);
    stop();
    expect(FakeObserver.made[0]?.disconnected).toBe(true);
    expect(removers[1]).toHaveBeenCalledTimes(1);
  });

  it("does nothing before the area renders", () => {
    const previewZone = vi.fn(() => vi.fn());
    keepPreviewInLogArea({ previewZone }, undefined)();
    expect(previewZone).not.toHaveBeenCalled();
  });
});
