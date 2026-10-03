import { describe, expect, it } from "vitest";
import { createChannelState } from "../../state";

describe("createChannelState", () => {
  it("starts with no timer, no listeners and no watches", () => {
    const state = createChannelState({ config: { heartbeatMs: 1000 } });

    expect(state.timer).toBeUndefined();
    expect(state.listeners).toBeInstanceOf(Set);
    expect(state.listeners.size).toBe(0);
    expect(state.watches).toBeInstanceOf(Set);
    expect(state.watches.size).toBe(0);
  });

  it("returns a fresh state on every call", () => {
    const config = { heartbeatMs: 1000 };

    expect(createChannelState({ config })).not.toBe(createChannelState({ config }));
    expect(createChannelState({ config }).watches).not.toBe(createChannelState({ config }).watches);
  });
});
