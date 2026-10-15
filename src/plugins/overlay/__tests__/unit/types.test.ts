import { describe, expect, expectTypeOf, it } from "vitest";
import type { DeviceLink } from "../../../hub/protocol";
import type { RecorderStatusEvent } from "../../../recorder/types";
import type { LinkStatus } from "../../../registry/protocol";
import { HOST_ATTRIBUTE as PROTOCOL_HOST_ATTRIBUTE } from "../../../registry/protocol";
import type {
  Config,
  OverlayApi,
  OverlayHooks,
  OverlayMode,
  OverlayTab,
  VisibleMode
} from "../../types";
import { HOST_ATTRIBUTE } from "../../types";

describe("overlay types", () => {
  it("Config is mode, dock, remember and mount", () => {
    expectTypeOf<Config["mode"]>().toEqualTypeOf<"hidden" | "pill" | "card">();
    expectTypeOf<Config["dock"]>().toEqualTypeOf<"left" | "right">();
    expectTypeOf<Config["remember"]>().toEqualTypeOf<boolean>();
    expectTypeOf<Config["mount"]>().toEqualTypeOf<string | undefined>();
  });

  it("rejects the old keys and a dock that is not an edge", () => {
    const corner: Config = {
      mode: "hidden",
      dock: "right",
      remember: true,
      mount: undefined,
      // @ts-expect-error — "corner" was replaced by dock
      corner: "top-left"
    };
    const top: Config = {
      mode: "hidden",
      // @ts-expect-error — "top" is not an edge
      dock: "top",
      remember: true,
      mount: undefined
    };
    expect([corner.dock, top.mode]).toEqual(["right", "hidden"]);
  });

  it("the hooks' payloads are the bridge's status and the recorder's event", () => {
    expectTypeOf<Parameters<OverlayHooks["bridge:status"]>[0]>().toEqualTypeOf<{
      status: LinkStatus;
      session?: string;
      link?: DeviceLink;
    }>();
    expectTypeOf<
      Parameters<OverlayHooks["recorder:status"]>[0]
    >().toEqualTypeOf<RecorderStatusEvent>();
  });

  it("the api is open, close, toggle, isOpen, mode, commands", () => {
    expectTypeOf<Parameters<OverlayApi["open"]>[0]>().toEqualTypeOf<
      { readonly mode?: VisibleMode; readonly tab?: OverlayTab } | undefined
    >();
    expectTypeOf<OverlayApi["mode"]>().toEqualTypeOf<() => OverlayMode>();
    expectTypeOf<ReturnType<OverlayApi["commands"]>[number]["kind"]>().toEqualTypeOf<
      "toggle" | "button"
    >();
  });

  it("keeps HOST_ATTRIBUTE in Overlay.*, the protocol's marker", () => {
    expect(HOST_ATTRIBUTE).toBe(PROTOCOL_HOST_ATTRIBUTE);
    expect(HOST_ATTRIBUTE).toBe("data-moku-editor-overlay");
  });
});
