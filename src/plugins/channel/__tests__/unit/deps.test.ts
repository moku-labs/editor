/* eslint-disable unicorn/no-null -- null is the wire value for "no input" */
import { describe, expect, it } from "vitest";
import { commandOf, depsOf, rawOf, sourceOf } from "../../deps";
import type { ChannelCtx } from "../../types";
import { createDeps, thrownBy } from "../helpers";

describe("sourceOf", () => {
  it("returns the registry entry of a known source", () => {
    const { registry } = createDeps();

    expect(sourceOf(registry, "game.position")).toBe(registry.sources.get("game.position"));
  });

  it("throws -32601 unknown_id with the id for an unknown source", () => {
    const { registry } = createDeps();

    expect(thrownBy(() => sourceOf(registry, "game.nope"))).toMatchObject({
      code: -32_601,
      message: "[moku-editor] game.nope: unknown source",
      data: { reason: "unknown_id", retryable: false, id: "game.nope" }
    });
  });
});

describe("commandOf", () => {
  it("returns the registry entry of a known command", () => {
    const { registry } = createDeps();

    expect(commandOf(registry, "game.step")).toBe(registry.commands.get("game.step"));
  });

  it("throws -32601 unknown_id with the id for an unknown command", () => {
    const { registry } = createDeps();

    expect(thrownBy(() => commandOf(registry, "game.nope"))).toMatchObject({
      code: -32_601,
      message: "[moku-editor] game.nope: unknown command",
      data: { reason: "unknown_id", retryable: false, id: "game.nope" }
    });
  });
});

describe("rawOf", () => {
  it("turns a missing input into null and keeps a given one", () => {
    expect(rawOf(undefined)).toBeNull();
    expect(rawOf(null)).toBeNull();
    expect(rawOf({ frames: 1 })).toEqual({ frames: 1 });
    expect(rawOf(0)).toBe(0);
  });
});

describe("depsOf", () => {
  it("builds the deps from the context and requires the registry once", () => {
    const deps = createDeps();
    let required = 0;
    const ctx = {
      config: deps.config,
      state: deps.state,
      log: deps.log,
      require: () => {
        required += 1;
        return deps.registry;
      }
    } as unknown as ChannelCtx;

    const built = depsOf(ctx);

    expect(built).toEqual({
      config: deps.config,
      state: deps.state,
      log: deps.log,
      registry: deps.registry
    });
    expect(required).toBe(1);
  });
});
