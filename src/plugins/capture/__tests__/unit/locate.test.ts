/* eslint-disable unicorn/no-null -- null is the wire value of "no element" */
import { describe, expect, it } from "vitest";
import { checkRect, cropOf, locateKey, rectSourceOf } from "../../locate";
import { fakeRegistry, thrownBy } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// Where editor.capture crops: a rect given in page CSS px, or the rect of a
// keyed element read from the rect source the manifest lists (game.locate on
// game 0.4, game.rect on game 0.1).
// ─────────────────────────────────────────────────────────────────────────────

/** A page rect of an element. */
const RECT = { x: 12, y: 40, w: 96, h: 24 };

describe("checkRect", () => {
  it("passes { x, y, w, h } with w and h above 0", () => {
    expect(checkRect(RECT)).toEqual(RECT);
    expect(checkRect({ x: -4, y: 0.5, w: 1, h: 0.5 })).toEqual({ x: -4, y: 0.5, w: 1, h: 0.5 });
  });

  it.each([
    null,
    [1, 2, 3, 4],
    "12,40,96,24",
    { x: 0, y: 0, w: 0, h: 10 },
    { x: 0, y: 0, w: 10, h: -1 },
    { x: 0, y: 0, w: 10 },
    { x: "0", y: 0, w: 10, h: 10 },
    { x: 0, y: 0, w: 10, h: 10, z: 1 }
  ])("refuses %j with -32602 naming rect", value => {
    expect(thrownBy(() => checkRect(value))).toMatchObject({
      code: -32_602,
      message:
        "[moku-editor] editor.capture: rect must be { x, y, w, h } in page CSS px, w and h above 0.\n  Pass the rect of an element, for example the rect of moku_selection.",
      data: { reason: "invalid_input", retryable: false, id: "editor.capture", field: "rect" }
    });
  });
});

describe("rectSourceOf", () => {
  it("answers game.locate when the registry has it (game 0.4)", () => {
    const registry = fakeRegistry(undefined, {
      sources: { "game.rect": () => null, "game.locate": () => null }
    });

    expect(rectSourceOf(registry)).toBe("game.locate");
  });

  it("answers game.rect on game 0.1", () => {
    expect(rectSourceOf(fakeRegistry(undefined, { sources: { "game.rect": () => null } }))).toBe(
      "game.rect"
    );
  });

  it("answers undefined when the registry has neither", () => {
    expect(rectSourceOf(fakeRegistry())).toBeUndefined();
  });
});

describe("locateKey", () => {
  it("reads the rect source with { key } and answers the page rect", () => {
    const registry = fakeRegistry(undefined, { sources: { "game.locate": () => RECT } });

    expect(locateKey(registry, "hud/infoBar")).toEqual(RECT);
    expect(registry.reads.get("game.locate")).toHaveBeenCalledWith({ key: "hud/infoBar" });
  });

  it("refuses a key with no element with -32602 naming key", () => {
    const registry = fakeRegistry(undefined, { sources: { "game.rect": () => null } });

    expect(thrownBy(() => locateKey(registry, "nope"))).toMatchObject({
      code: -32_602,
      message:
        '[moku-editor] editor.capture: no element with key "nope".\n  Pass the key of a placed ui node; moku_selection shows it.',
      data: { reason: "invalid_input", retryable: false, id: "editor.capture", field: "key" }
    });
  });

  it("refuses a key when the game reports no element rects", () => {
    expect(thrownBy(() => locateKey(fakeRegistry(), "hud"))).toMatchObject({
      code: -32_602,
      message:
        "[moku-editor] editor.capture: this game reports no element rects (no game.locate, no game.rect).\n  Pass rect instead, or update the game.",
      data: { reason: "invalid_input", id: "editor.capture", field: "key" }
    });
  });

  it("passes an error of the source through unchanged", () => {
    const refused = new Error("[game] locate needs a key or a target.");
    const registry = fakeRegistry(undefined, {
      sources: {
        "game.locate": () => {
          throw refused;
        }
      }
    });

    expect(thrownBy(() => locateKey(registry, "hud"))).toBe(refused);
  });
});

describe("cropOf", () => {
  it("answers no crop without key and rect", () => {
    expect(cropOf({}, fakeRegistry())).toBeUndefined();
  });

  it("crops to a given rect", () => {
    expect(cropOf({ rect: RECT }, fakeRegistry())).toEqual({ rect: RECT, field: "rect" });
  });

  it("crops to the located rect of a key", () => {
    const registry = fakeRegistry(undefined, { sources: { "game.locate": () => RECT } });

    expect(cropOf({ key: "hud" }, registry)).toEqual({ rect: RECT, field: "key" });
  });

  it("takes the rect over the key and reads nothing", () => {
    const registry = fakeRegistry(undefined, { sources: { "game.locate": () => null } });

    expect(cropOf({ key: "hud", rect: RECT }, registry)).toEqual({ rect: RECT, field: "rect" });
    expect(registry.reads.get("game.locate")).not.toHaveBeenCalled();
  });
});
