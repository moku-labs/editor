// @vitest-environment happy-dom
import type { VNode } from "preact";
import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMission } from "../../components/useMission";
import { notify, notifyMission } from "../../state";
import type { MissionState } from "../../types";
import { createCtx } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// components/useMission.ts (spec 09 § M14): Mission control's components
// re-render on notifyMission, from the first render on, and drop their
// subscription when they unmount. Bug: a frames answer that lands right after
// the first render never shown, or a listener left behind by every mount.
// ─────────────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  document.body.innerHTML = "";
});

/**
 * Shows the selection version, through the hook under test.
 *
 * @param props - Mission control's state.
 * @param props.mission - Mission control's state.
 * @returns The probe.
 */
function Probe(props: { readonly mission: MissionState }): VNode {
  const { mission } = props;
  const version = useMission(mission, () => mission.selectionVersion);
  return <span>{version}</span>;
}

describe("useMission", () => {
  it("a notifyMission right after the first render reaches the component; the scene cards' notify does not", async () => {
    const { state } = createCtx();
    const root = document.createElement("div");
    document.body.append(root);
    // No act(): effects run on Preact's own schedule, as in the tools page.
    render(<Probe mission={state.mission} />, root);
    expect(root.textContent).toBe("0");

    state.mission.selectionVersion = 1;
    notify(state);
    await vi.runAllTimersAsync();
    expect(root.textContent).toBe("0");

    notifyMission(state.mission);
    await vi.runAllTimersAsync();
    expect(root.textContent).toBe("1");

    render(undefined, root);
    expect(state.mission.listeners.size).toBe(0);
  });
});
