import { describe, expect, it } from "vitest";
import { createRegistryState } from "../../state";

describe("createRegistryState", () => {
  it("starts with empty maps and no manifest", () => {
    const state = createRegistryState();

    expect(state.sources.size).toBe(0);
    expect(state.commands.size).toBe(0);
    expect(state.origins.size).toBe(0);
    expect(state.manifest).toBeUndefined();
    expect(state.unavailable.size).toBe(0);
    expect(state.probes.size).toBe(0);
  });

  it("returns fresh maps on every call", () => {
    const first = createRegistryState();
    const second = createRegistryState();

    expect(first.sources).not.toBe(second.sources);
    expect(first.commands).not.toBe(second.commands);
    expect(first.unavailable).not.toBe(second.unavailable);
    expect(first.probes).not.toBe(second.probes);
  });
});
