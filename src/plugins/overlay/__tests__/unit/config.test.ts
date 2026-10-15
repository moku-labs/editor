import { describe, expect, it } from "vitest";
import { initOverlay } from "../../lifecycle";
import type { Config } from "../../types";
import { createOctx, pluginCtxOf } from "../helpers";

/**
 * Runs onInit with a config a JavaScript caller passed past the type.
 *
 * @param extra - Fields to add or replace.
 * @returns What onInit threw.
 */
function initWith(extra: Record<string, unknown>): unknown {
  const octx = createOctx(extra as Partial<Config>);
  try {
    initOverlay(pluginCtxOf(octx));
  } catch (error) {
    return error;
  }
  return undefined;
}

describe("overlay config checks", () => {
  it("`corner` passes silently (it throws the migration error)", () => {
    const error = initWith({ corner: "top-left" });
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(
      '[moku-editor] overlay.corner was replaced by overlay.dock ("left" | "right").\n  Fix pluginConfigs.overlay, for example { dock: "left" }.'
    );
  });

  it("`open: true` passes silently (it throws the migration error)", () => {
    const error = initWith({ open: true });
    expect(error).toBeInstanceOf(TypeError);
    expect((error as Error).message).toBe(
      '[moku-editor] overlay.open was replaced by overlay.mode ("hidden" | "pill" | "card").\n  Fix pluginConfigs.overlay, for example { mode: "card" }.'
    );
  });

  it("a `dock: 'top'` is accepted (each bad field is a two-line TypeError)", () => {
    const cases: [Record<string, unknown>, string][] = [
      [{ dock: "top" }, '[moku-editor] overlay.dock is "top".\n  Use "left" or "right".'],
      [
        { mode: "open" },
        '[moku-editor] overlay.mode is "open".\n  Use "hidden", "pill" or "card".'
      ],
      [{ remember: "yes" }, '[moku-editor] overlay.remember is "yes".\n  Use true or false.']
    ];
    for (const [extra, message] of cases) {
      const error = initWith(extra);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as Error).message).toBe(message);
    }
  });

  it("accepts the defaults and every valid value", () => {
    expect(initWith({})).toBeUndefined();
    expect(
      initWith({ mode: "pill", dock: "left", remember: false, mount: "#game" })
    ).toBeUndefined();
  });
});
