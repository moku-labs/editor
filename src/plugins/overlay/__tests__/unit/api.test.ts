// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import { createOverlayApi } from "../../api";
import { createOctx, GARDEN_COMMANDS, pluginCtxOf, started, stopped } from "../helpers";

afterEach(() => {
  Reflect.deleteProperty(globalThis, "__MOKU_GAME_OVERLAY__");
});

describe("createOverlayApi", () => {
  it("opens, closes, toggles and answers isOpen and mode", () => {
    const octx = createOctx();
    const api = createOverlayApi(pluginCtxOf(octx));
    expect(api.isOpen()).toBe(false);
    api.open({ mode: "pill" });
    expect([api.isOpen(), api.mode()]).toEqual([true, "pill"]);
    api.close();
    expect([api.isOpen(), api.mode()]).toEqual([false, "hidden"]);
    api.toggle();
    expect(api.mode()).toBe("pill");
    api.open({ tab: "link" });
    expect([api.mode(), octx.state.tab]).toEqual(["card", "link"]);
  });

  it("lists only the overlay commands, in manifest order, with a toggle's value read now", () => {
    const octx = createOctx({}, GARDEN_COMMANDS);
    octx.registry.values.set("garden.glow", false);
    octx.registry.values.set("garden.fog", true);
    const api = createOverlayApi(pluginCtxOf(octx));
    expect(api.commands().map(command => [command.id, command.value, command.allowed])).toEqual([
      ["garden.glow", false, true],
      ["garden.fog", true, true],
      ["story.skipDialogue", undefined, false]
    ]);
    expect(api.commands()[2]).toMatchObject({
      kind: "button",
      reason: "needs a debug build of a newer engine, or without --debug=read"
    });
    octx.registry.values.set("garden.glow", true);
    expect(api.commands()[0]?.value).toBe(true);
    expect(api.commands()).not.toBe(api.commands());
  });

  it("answers an empty list without overlay commands", () => {
    expect(createOverlayApi(pluginCtxOf(createOctx())).commands()).toEqual([]);
  });

  it("drives a mounted overlay", () => {
    const octx = started(createOctx());
    const api = createOverlayApi(pluginCtxOf(octx));
    api.open();
    expect(octx.state.root?.querySelector('[data-overlay="card"]')).not.toBeNull();
    stopped(octx);
  });
});
