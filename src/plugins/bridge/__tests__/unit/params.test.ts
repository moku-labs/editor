import { describe, expect, it } from "vitest";
import { checkParams, deadlineFor, PARAMS } from "../../dispatch/params";

/**
 * Runs a function and returns what it threw.
 *
 * @param fn - The function.
 * @returns The thrown value.
 */
function thrownBy(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error("expected a throw");
}

describe("PARAMS", () => {
  it("declares the params of the five game methods", () => {
    expect(PARAMS).toEqual({
      manifest: {},
      read: { id: "string", input: "json?" },
      watch: { sub: "number", id: "string", input: "json?" },
      unwatch: { sub: "number" },
      run: { id: "string", input: "json?" }
    });
  });
});

describe("checkParams", () => {
  it("accepts no params for manifest", () => {
    expect(checkParams("manifest", undefined)).toEqual({});
  });

  it("returns the checked params", () => {
    expect(checkParams("read", { id: "game.position" })).toEqual({ id: "game.position" });
    expect(checkParams("run", { id: "game.step", input: { frames: 1 } })).toEqual({
      id: "game.step",
      input: { frames: 1 }
    });
    expect(checkParams("watch", { sub: 0, id: "game.position" })).toEqual({
      sub: 0,
      id: "game.position"
    });
    expect(checkParams("unwatch", { sub: 7 })).toEqual({ sub: 7 });
  });

  it("rejects a missing or mistyped field with -32602 and the field", () => {
    expect(thrownBy(() => checkParams("read", {}))).toMatchObject({
      code: -32_602,
      data: { field: "id" }
    });
    expect(thrownBy(() => checkParams("run", { id: 1 }))).toMatchObject({ data: { field: "id" } });
  });

  it("rejects an unknown field", () => {
    expect(thrownBy(() => checkParams("unwatch", { sub: 1, id: "x" }))).toMatchObject({
      code: -32_602,
      data: { field: "id" }
    });
  });

  it.each([-1, 1.5, "1", Number.MAX_SAFE_INTEGER + 2])("rejects sub %s", sub => {
    const error = thrownBy(() => checkParams("watch", { sub, id: "game.position" }));

    expect(error).toMatchObject({ code: -32_602, data: { field: "sub", reason: "invalid_input" } });
    expect(error).toHaveProperty("message", expect.stringMatching(/^\[moku-editor\] /));
  });

  it("checks the sub of unwatch too", () => {
    expect(thrownBy(() => checkParams("unwatch", { sub: -3 }))).toMatchObject({
      data: { field: "sub" }
    });
  });
});

describe("deadlineFor", () => {
  it("gives editor.series its durationMs on top", () => {
    expect(deadlineFor("run", { id: "editor.series", input: { durationMs: 20_000 } }, 5000)).toBe(
      25_000
    );
  });

  it("caps the extra time at 60 s", () => {
    expect(deadlineFor("run", { id: "editor.series", input: { durationMs: 90_000 } }, 5000)).toBe(
      65_000
    );
  });

  it("gives editor.sheet its frames × everyMs on top, capped at 60 s", () => {
    expect(
      deadlineFor("run", { id: "editor.sheet", input: { frames: 6, everyMs: 500 } }, 5000)
    ).toBe(8000);
    expect(
      deadlineFor("run", { id: "editor.sheet", input: { frames: 12, everyMs: 9000 } }, 5000)
    ).toBe(65_000);
  });

  it.each([
    ["a sheet without everyMs", { id: "editor.sheet", input: { frames: 6 } }],
    ["a sheet with a text frames", { id: "editor.sheet", input: { frames: "6", everyMs: 500 } }],
    ["a text durationMs", { id: "editor.series", input: { durationMs: "x" } }],
    ["a negative durationMs", { id: "editor.series", input: { durationMs: -1 } }],
    ["no input", { id: "editor.series" }],
    ["another command", { id: "game.step", input: { durationMs: 20_000 } }],
    ["no params", undefined]
  ])("keeps callTimeoutMs for %s", (_name, params) => {
    expect(deadlineFor("run", params, 5000)).toBe(5000);
  });

  it("keeps callTimeoutMs for read, even of editor.series", () => {
    expect(deadlineFor("read", { id: "editor.series", input: { durationMs: 1000 } }, 5000)).toBe(
      5000
    );
  });
});
