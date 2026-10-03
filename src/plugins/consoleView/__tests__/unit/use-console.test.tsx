// @vitest-environment happy-dom
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createConsoleApi } from "../../api";
import { startConsole } from "../../lifecycle";
import type { ConsoleApi } from "../../types";
import { useConsole } from "../../view/useConsole";
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
