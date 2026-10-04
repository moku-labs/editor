import { describe, expect, expectTypeOf, it } from "vitest";
import type { LinkStatus } from "../../../registry/protocol";
import { HOST_ATTRIBUTE as PROTOCOL_HOST_ATTRIBUTE } from "../../../registry/protocol";
import type { Config, OverlayApi, OverlayHooks } from "../../types";
import { HOST_ATTRIBUTE } from "../../types";

describe("overlay types", () => {
  it("Config corner is the four-corner union", () => {
    expectTypeOf<Config["corner"]>().toEqualTypeOf<
      "top-right" | "top-left" | "bottom-right" | "bottom-left"
    >();
    expectTypeOf<Config["open"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Config["mount"]>().toEqualTypeOf<string | undefined>();
  });

  it("rejects an unknown corner", () => {
    // @ts-expect-error — "center" is not a corner
    const config: Config = { open: false, corner: "center", mount: undefined };
    expectTypeOf(config).toEqualTypeOf<Config>();
  });

  it("the hook payload is { status; session? }", () => {
    expectTypeOf<Parameters<OverlayHooks["bridge:status"]>[0]>().toEqualTypeOf<{
      status: LinkStatus;
      session?: string;
    }>();
  });

  it("the api is open, close, isOpen", () => {
    expectTypeOf<OverlayApi["open"]>().toEqualTypeOf<() => void>();
    expectTypeOf<OverlayApi["close"]>().toEqualTypeOf<() => void>();
    expectTypeOf<OverlayApi["isOpen"]>().toEqualTypeOf<() => boolean>();
  });

  it("keeps HOST_ATTRIBUTE in Overlay.*, the protocol's marker", () => {
    expect(HOST_ATTRIBUTE).toBe(PROTOCOL_HOST_ATTRIBUTE);
    expect(HOST_ATTRIBUTE).toBe("data-moku-editor-overlay");
  });
});
