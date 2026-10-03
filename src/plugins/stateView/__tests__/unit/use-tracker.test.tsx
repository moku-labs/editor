// @vitest-environment happy-dom
import type { VNode } from "preact";
import { render } from "preact";
import { afterEach, describe, expect, it } from "vitest";
import { createStateViewApi } from "../../api";
import { acceptModel } from "../../tracker";
import type { StateViewApi } from "../../types";
import { useTracker } from "../../view/useTracker";
import { MODEL_AFTER, MODEL_BEFORE } from "../fixtures";
import { createCtx } from "../helpers";

afterEach(() => {
  document.body.innerHTML = "";
});

/**
 * Shows the seq of the last commit, through the hook under test.
 *
 * @param props - The stateView api.
 * @param props.api - The stateView api.
 * @returns The probe.
 */
function Probe(props: { readonly api: StateViewApi }): VNode {
  const last = useTracker(props.api);
  return <span>{last === undefined ? "none" : `seq ${last.seq}`}</span>;
}

/**
 * Lets Preact's after-paint effects (a 100 ms fallback timer) and the re-render run.
 *
 * @returns Resolves after 150 ms.
 */
async function afterPaint(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 150));
}

describe("useTracker", () => {
  it("a commit right after the first render reaches the component", async () => {
    const ctx = createCtx();
    acceptModel(ctx, MODEL_BEFORE);
    const api = createStateViewApi(ctx);
    const root = document.createElement("div");
    document.body.append(root);
    // No act(): effects run on Preact's own schedule, as in the tools page.
    render(<Probe api={api} />, root);
    expect(root.textContent).toBe("none");
    acceptModel(ctx, MODEL_AFTER);
    await afterPaint();
    expect(root.textContent).toBe("seq 1");
    render(undefined, root);
    expect(ctx.state.listeners.size).toBe(0);
  });
});
