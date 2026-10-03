// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { isWireError } from "../../../registry/protocol";
import { initOverlay, registerOverlayCommand } from "../../command";
import type { TestOctx } from "../helpers";
import { createOctx, ENVELOPE, pluginCtxOf } from "../helpers";

/**
 * Registers the command and returns its entry.
 *
 * @param octx - The test context.
 * @returns The added entry.
 */
function entryOf(octx: TestOctx) {
  registerOverlayCommand(octx);
  const entry = octx.registry.added[0];
  if (entry === undefined) throw new Error("no entry added");
  return entry;
}

/**
 * Awaits a rejection and returns its reason.
 *
 * @param promise - The promise.
 * @returns What it rejected with.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected a rejection");
}

describe("editor.overlay", () => {
  it("is a cosmetic command with a boolean input", () => {
    const octx = createOctx();

    expect(entryOf(octx).descriptor).toEqual({
      id: "editor.overlay",
      title: "Overlay in game",
      input: { on: "boolean" },
      effect: "cosmetic"
    });
    expect(octx.registry.added).toHaveLength(1);
  });

  it("opens and answers { on: true } with the registry envelope", async () => {
    const octx = createOctx();

    const result = await entryOf(octx).run({ on: true });

    expect(result).toEqual({ value: { on: true }, state: ENVELOPE });
    expect(octx.state.open).toBe(true);
  });

  it("closes and answers { on: false }", async () => {
    const octx = createOctx();
    octx.state.open = true;

    const result = await entryOf(octx).run({ on: false });

    expect(result.value).toEqual({ on: false });
    expect(octx.state.open).toBe(false);
  });

  it.each([{ on: "yes" }, { on: true, x: 1 }, {}])("refuses %j with -32602", async raw => {
    const octx = createOctx();

    const error = await rejectionOf(entryOf(octx).run(raw));

    expect(isWireError(error)).toBe(true);
    expect(error).toMatchObject({ code: -32_602 });
    expect((error as Error).message.startsWith("[moku-editor] ")).toBe(true);
    expect(octx.state.open).toBe(false);
  });

  it("is added by initOverlay over the plugin context", () => {
    const octx = createOctx();

    initOverlay(pluginCtxOf(octx));

    expect(octx.registry.added[0]?.descriptor.id).toBe("editor.overlay");
  });
});
