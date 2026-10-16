import { describe, expect, expectTypeOf, it } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { buildBridgeApi } from "../../api";
import type { BridgeApi } from "../../types";
import { createDeps, deviceDeps, LAN, openDeps } from "../helpers";

describe("buildBridgeApi", () => {
  it("status() is connecting before start", () => {
    const deps = createDeps();

    expect(buildBridgeApi(deps).status()).toEqual({ kind: "connecting" });
  });

  it("status() reads the phase and the channel heartbeat", () => {
    const { deps } = openDeps();
    const api = buildBridgeApi(deps);

    expect(api.status()).toEqual({ kind: "live", frame: 12 });
    deps.channel.beat = { frame: 20, paused: true, at: 1 };
    expect(api.status()).toEqual({ kind: "paused", frame: 20 });
    deps.state.phase = "stopped";
    expect(api.status()).toMatchObject({ kind: "lost", reason: "stopped" });
  });

  it("session() reads the state only", () => {
    const deps = createDeps();
    const api = buildBridgeApi(deps);

    expect(api.session()).toBeUndefined();
    deps.state.session = "s-7f3a";
    expect(api.session()).toBe("s-7f3a");
  });

  it("is typed as BridgeApi", () => {
    const api = buildBridgeApi(createDeps());

    expectTypeOf(api).toEqualTypeOf<BridgeApi>();
    expectTypeOf(api.status).returns.toEqualTypeOf<LinkStatus>();
    expectTypeOf(api.session).returns.toEqualTypeOf<string | undefined>();
    expect(Object.keys(api).toSorted()).toEqual(["connect", "link", "session", "status"]);
  });

  it("link() is undefined in page mode and a fresh copy of the device link in device mode", () => {
    expect(buildBridgeApi(createDeps()).link()).toBeUndefined();

    const deps = deviceDeps();
    deps.state.phase = "pairing";
    deps.state.pairing = { code: "4821" };
    const api = buildBridgeApi(deps);
    const link = api.link();

    expect(link).toEqual({ mode: "connecting", address: LAN, pairing: { code: "4821" } });
    expect(api.link()).not.toBe(link);
  });
});
