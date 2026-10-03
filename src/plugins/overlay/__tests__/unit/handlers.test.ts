// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { createHandlers, handleBridgeStatus } from "../../handlers";
import { createOctx, pluginCtxOf } from "../helpers";

/**
 * Gives the state a shadow root so paint renders.
 *
 * @param octx - The test context.
 * @returns The root.
 */
function withRoot(octx: ReturnType<typeof createOctx>): ShadowRoot {
  const root = document.createElement("div").attachShadow({ mode: "open" });
  octx.state.root = root;
  return root;
}

describe("handleBridgeStatus", () => {
  it("stores the status and the session", () => {
    const octx = createOctx();

    handleBridgeStatus(octx)({ status: { kind: "live", frame: 12 }, session: "s-7f3a" });

    expect(octx.state.link).toEqual({ kind: "live", frame: 12 });
    expect(octx.state.session).toBe("s-7f3a");
  });

  it("clears the session when the payload has none", () => {
    const octx = createOctx();
    octx.state.session = "s-old";

    handleBridgeStatus(octx)({ status: { kind: "empty" } });

    expect(octx.state.session).toBeUndefined();
  });

  it("repaints when open", () => {
    const octx = createOctx();
    const root = withRoot(octx);
    octx.state.hasBridge = true;
    octx.state.open = true;

    handleBridgeStatus(octx)({ status: { kind: "paused", frame: 40 } });

    expect(root.querySelector<HTMLElement>("[data-dot]")?.dataset.kind).toBe("paused");
  });

  it("does not repaint when closed", () => {
    const octx = createOctx();
    const root = withRoot(octx);
    octx.state.hasBridge = true;

    handleBridgeStatus(octx)({ status: { kind: "live", frame: 1 } });

    expect(root.childNodes).toHaveLength(0);
  });
});

describe("createHandlers", () => {
  it("hooks bridge:status over the plugin context", () => {
    const octx = createOctx();
    createHandlers(pluginCtxOf(octx))["bridge:status"]({ status: { kind: "live", frame: 3 } });

    expect(octx.state.link).toEqual({ kind: "live", frame: 3 });
  });
});
