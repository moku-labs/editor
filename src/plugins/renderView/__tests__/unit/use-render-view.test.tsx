// @vitest-environment happy-dom
import type { VNode } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useRenderView } from "../../components/useRenderView";
import { notify } from "../../state";
import type { RenderViewState } from "../../types";
import { createCtx } from "../helpers";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Shows the number of fps samples, through the hook under test.
 *
 * @param props - The renderView state.
 * @param props.state - The renderView state.
 * @returns The probe.
 */
function Probe(props: { readonly state: RenderViewState }): VNode {
  const { state } = props;
  const samples = useRenderView(state, () => state.fps.length);
  return <span>{samples}</span>;
}

/**
 * Lets Preact's after-paint effects and the re-render run: runs every pending fake timer, with
 * the microtasks between them.
 *
 * @returns Resolves when no timer is pending.
 */
async function afterPaint(): Promise<void> {
  await vi.runAllTimersAsync();
}

describe("useRenderView", () => {
  it("a notify right after the first render reaches the component", async () => {
    const { state } = createCtx();
    const root = document.createElement("div");
    document.body.append(root);
    // No act(): effects run on Preact's own schedule, as in the tools page.
    render(<Probe state={state} />, root);
    expect(root.textContent).toBe("0");
    state.fps.push(60);
    notify(state);
    await afterPaint();
    expect(root.textContent).toBe("1");
    render(undefined, root);
    expect(state.listeners.size).toBe(0);
  });
});
