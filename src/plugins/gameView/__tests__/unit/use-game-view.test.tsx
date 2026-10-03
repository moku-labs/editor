// @vitest-environment happy-dom
import type { VNode } from "preact";
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { createGameViewState, notify } from "../../state";
import type { GameViewState } from "../../types";
import { useGameView } from "../../ui/useGameView";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Shows whether the picker is on, through the hook under test.
 *
 * @param props - The gameView state.
 * @param props.state - The gameView state.
 * @returns The probe.
 */
function Probe(props: { readonly state: GameViewState }): VNode {
  const { state } = props;
  const on = useGameView(state, () => state.picker.on);
  return <span>{on ? "on" : "off"}</span>;
}

/**
 * Lets Preact's after-paint effects (a 100 ms fallback timer) and the re-render run.
 *
 * @returns Resolves after 150 ms.
 */
async function afterPaint(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 150));
}

describe("useGameView", () => {
  it("a notify right after the first render reaches the component (M2b)", async () => {
    const state = createGameViewState();
    const root = document.createElement("div");
    document.body.append(root);
    // No act(): effects run on Preact's own schedule, as in the tools page.
    render(<Probe state={state} />, root);
    expect(root.textContent).toBe("off");
    state.picker = { on: true, hover: undefined };
    notify(state);
    await afterPaint();
    expect(root.textContent).toBe("on");
    render(undefined, root);
    expect(state.listeners.size).toBe(0);
  });
});
