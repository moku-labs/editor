import { describe, expect, it } from "vitest";
import { registerOverlayCommand } from "../../command";
import { initOverlay } from "../../lifecycle";
import { createOctx, ENVELOPE, pluginCtxOf, type TestOctx } from "../helpers";

/**
 * The editor.overlay entry a context added.
 *
 * @param octx - The test context.
 * @returns The entry.
 */
function entryOf(octx: TestOctx) {
  registerOverlayCommand(octx);
  const entry = octx.registry.added.find(added => added.descriptor.id === "editor.overlay");
  if (entry === undefined) throw new Error("editor.overlay was not added");
  return entry;
}

describe("editor.overlay", () => {
  it("is a cosmetic command with a mode input", () => {
    expect(entryOf(createOctx()).descriptor).toEqual({
      id: "editor.overlay",
      title: "Overlay in game",
      input: { mode: "string" },
      effect: "cosmetic"
    });
  });

  it("switches the mode and answers it with the registry envelope", async () => {
    const octx = createOctx();
    const entry = entryOf(octx);
    expect(await entry.run({ mode: "pill" })).toEqual({ value: { mode: "pill" }, state: ENVELOPE });
    expect(await entry.run({ mode: "card" })).toEqual({ value: { mode: "card" }, state: ENVELOPE });
    expect(await entry.run({ mode: "hidden" })).toEqual({
      value: { mode: "hidden" },
      state: ENVELOPE
    });
  });

  it("the value reports the asked mode instead of the mode after the call", async () => {
    const octx = createOctx();
    const entry = entryOf(octx);
    const result = await entry.run({ mode: "pill" });
    expect(result.value).toEqual({ mode: octx.state.mode });
  });

  it("{ on: true } still opens (it is refused with -32602)", async () => {
    const octx = createOctx();
    await expect(entryOf(octx).run({ on: true })).rejects.toMatchObject({
      code: -32_602,
      message: "[moku-editor] on is not a known input"
    });
    expect(octx.state.mode).toBe("hidden");
  });

  it("mode: 'full' closes the overlay (it is refused, the mode stays)", async () => {
    const octx = createOctx();
    const entry = entryOf(octx);
    await entry.run({ mode: "card" });
    await expect(entry.run({ mode: "full" })).rejects.toMatchObject({
      code: -32_602,
      data: { reason: "invalid_input", field: "mode" }
    });
    expect(octx.state.mode).toBe("card");
  });

  it("the -32602 message has no fix line (it has two lines)", async () => {
    await expect(entryOf(createOctx()).run({ mode: "open" })).rejects.toThrow(
      '[moku-editor] editor.overlay: mode must be "hidden", "pill" or "card".\n  Run it with { mode: "card" }.'
    );
  });

  it("is added by initOverlay over the plugin context", () => {
    const octx = createOctx();
    initOverlay(pluginCtxOf(octx));
    expect(octx.registry.added.map(entry => entry.descriptor.id)).toEqual(["editor.overlay"]);
  });
});
