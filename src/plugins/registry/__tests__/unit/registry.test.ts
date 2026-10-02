import { describe, expect, it } from "vitest";
import { registryPlugin } from "../..";
import { createRegistryState } from "../../state";

// ─────────────────────────────────────────────────────────────────────────────
// The plugin instance and its state factory
// ─────────────────────────────────────────────────────────────────────────────

describe("createRegistryState", () => {
  it("starts with empty maps and no manifest", () => {
    const state = createRegistryState();

    expect(state.sources).toBeInstanceOf(Map);
    expect(state.sources.size).toBe(0);
    expect(state.commands.size).toBe(0);
    expect(state.origins.size).toBe(0);
    expect(state.manifest).toBeUndefined();
  });

  it("returns fresh maps every time", () => {
    const first = createRegistryState();
    const second = createRegistryState();

    expect(first.sources).not.toBe(second.sources);
    expect(first.commands).not.toBe(second.commands);
    expect(first.origins).not.toBe(second.origins);
  });
});

describe("registryPlugin", () => {
  it("is named registry", () => {
    expect(registryPlugin.name).toBe("registry");
  });

  it("defaults to no game, no modules and no name", () => {
    expect(registryPlugin.spec.config).toEqual({ game: undefined, modules: [], name: undefined });
  });

  it("wires state, api and onInit, and no start or stop", () => {
    expect(registryPlugin.spec.createState).toBe(createRegistryState);
    expect(typeof registryPlugin.spec.api).toBe("function");
    expect(typeof registryPlugin.spec.onInit).toBe("function");
    expect("onStart" in registryPlugin.spec).toBe(false);
    expect("onStop" in registryPlugin.spec).toBe(false);
    expect("events" in registryPlugin.spec).toBe(false);
    expect("depends" in registryPlugin.spec).toBe(false);
  });
});
