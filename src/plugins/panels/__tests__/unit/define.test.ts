/* eslint-disable unicorn/no-null -- null is a JSON value and Preact's "no props" */
import { h } from "preact";
import { describe, expect, it, vi } from "vitest";
import type { Json } from "../../../registry/protocol";
import { definePanel } from "../../define";
import type { PanelInput, PanelTools } from "../../types";

// ─────────────────────────────────────────────────────────────────────────────
// definePanel: plain data, frozen and erased; every malformed field throws the
// two-line `[moku-editor] … is invalid.\n  <fix>.` message.
// ─────────────────────────────────────────────────────────────────────────────

/** The input of a valid panel; tests override one field at a time. */
type AnyInput = PanelInput<
  Readonly<Record<string, string | readonly [string, Json]>>,
  Readonly<Record<string, string>>
>;

/**
 * A valid input with overrides (cast: the tests feed malformed values on purpose).
 *
 * @param overrides - Fields to replace.
 * @returns The input.
 */
function inputWith(overrides: Record<string, unknown> = {}): AnyInput {
  const base = {
    id: "flow",
    title: "Flow",
    workspace: "flow",
    sources: { graph: "game.graph", history: ["game.history", { last: 20 }] },
    commands: { step: "game.step" },
    view: () => h("div", null, "flow")
  };
  return { ...base, ...overrides } as unknown as AnyInput;
}

/**
 * The message of what a call throws.
 *
 * @param call - The call.
 * @returns The message, or "" when it did not throw.
 */
function messageOf(call: () => unknown): string {
  try {
    call();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("definePanel: the registered form", () => {
  it("returns a frozen spec with the fields, commands {} by default and compact undefined", () => {
    const spec = definePanel({
      id: "state",
      title: "State",
      workspace: "state",
      sources: { model: "game.model" },
      view: () => h("div", null)
    });
    expect(spec).toMatchObject({
      id: "state",
      title: "State",
      workspace: "state",
      sources: { model: "game.model" },
      commands: {}
    });
    expect(spec.compact).toBeUndefined();
    expect(Object.isFrozen(spec)).toBe(true);
    expect(Object.isFrozen(spec.sources)).toBe(true);
    expect(Object.isFrozen(spec.commands)).toBe(true);
  });

  it("keeps tuple refs as [id, input] pairs, frozen", () => {
    const spec = definePanel(inputWith());
    expect(spec.sources.history).toEqual(["game.history", { last: 20 }]);
    expect(Object.isFrozen(spec.sources.history)).toBe(true);
  });

  it("copies sources and commands, so a later change to the input does not leak in", () => {
    const sources: Record<string, string> = { graph: "game.graph" };
    const spec = definePanel(inputWith({ sources }));
    sources.position = "game.position";
    expect(Object.keys(spec.sources)).toEqual(["graph"]);
  });

  it("the erased view calls the typed view with the values and tools it is given", () => {
    const view = vi.fn(() => h("p", null, "ok"));
    const spec = definePanel(inputWith({ view }));
    const tools = { status: { kind: "empty" } } as unknown as PanelTools<
      Readonly<Record<string, string>>
    >;
    const node = spec.view({ graph: { main: "main" } }, tools);
    expect(view).toHaveBeenCalledWith({ graph: { main: "main" } }, tools);
    expect(node.type).toBe("p");
  });

  it("keeps a compact view when given", () => {
    const compact = vi.fn(() => h("span", null));
    const spec = definePanel(inputWith({ compact }));
    expect(typeof spec.compact).toBe("function");
  });

  it("accepts sources {} and a dotted panel id", () => {
    const spec = definePanel(inputWith({ id: "flow.inspector", sources: {} }));
    expect(spec.id).toBe("flow.inspector");
    expect(spec.sources).toEqual({});
  });
});

describe("definePanel: validation messages", () => {
  it("rejects a malformed panel id", () => {
    for (const id of ["Flow", "", "flow..x", "1flow", "flow-x", 3]) {
      expect(messageOf(() => definePanel(inputWith({ id })))).toBe(
        `[moku-editor] Panel id ${JSON.stringify(id)} is invalid.\n  Use camelCase words joined by dots, like "flow" or "flow.inspector".`
      );
    }
  });

  it("rejects a workspace that is not one of the six", () => {
    expect(messageOf(() => definePanel(inputWith({ workspace: "nope" })))).toBe(
      '[moku-editor] Panel "flow": workspace "nope" is invalid.\n  Use flow, game, render, state, files or console.'
    );
  });

  it("rejects sources that are not an object", () => {
    for (const sources of [null, [], "game.graph"]) {
      expect(messageOf(() => definePanel(inputWith({ sources })))).toBe(
        '[moku-editor] Panel "flow": sources is invalid.\n  Pass an object of name → source ref, or {}.'
      );
    }
  });

  it("rejects a malformed source ref", () => {
    const bad: unknown[] = [
      "graph",
      "Game.graph",
      3,
      ["game.history"],
      ["game.history", { last: 20 }, "extra"],
      ["history", {}],
      ["game.history", undefined],
      ["game.history", () => 1],
      ["game.history", { last: Number.NaN }]
    ];
    for (const ref of bad) {
      expect(messageOf(() => definePanel(inputWith({ sources: { graph: ref } })))).toBe(
        '[moku-editor] Panel "flow": source "graph" is invalid.\n  Use a dotted source id like "game.graph", or a pair like ["game.history", { "last": 20 }].'
      );
    }
  });

  it("accepts every Json input of a tuple ref", () => {
    const inputs: Json[] = [null, true, 1, "x", [1, "a"], { a: { b: [null] } }];
    for (const input of inputs) {
      expect(() =>
        definePanel(inputWith({ sources: { history: ["game.history", input] } }))
      ).not.toThrow();
    }
  });

  it("rejects commands that are not an object, and a malformed command id", () => {
    expect(messageOf(() => definePanel(inputWith({ commands: [] })))).toBe(
      '[moku-editor] Panel "flow": commands is invalid.\n  Pass an object of name → command id, or leave it out.'
    );
    for (const id of ["step", 3, "game.Step!"]) {
      expect(messageOf(() => definePanel(inputWith({ commands: { step: id } })))).toBe(
        '[moku-editor] Panel "flow": command "step" is invalid.\n  Use a dotted command id like "game.step".'
      );
    }
  });

  it("rejects a view that is not a function and a compact that is neither a function nor absent", () => {
    expect(messageOf(() => definePanel(inputWith({ view: "x" })))).toBe(
      '[moku-editor] Panel "flow": view is invalid.\n  Pass a function (values, tools) => element.'
    );
    expect(messageOf(() => definePanel(inputWith({ compact: 1 })))).toBe(
      '[moku-editor] Panel "flow": compact is invalid.\n  Pass a function (values, tools) => element, or leave it out.'
    );
  });
});
