import { describe, expect, it } from "vitest";
import { pairDeviceOf } from "../../pair-device";
import { BUILD, PAGE_FLAGS } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// pairDeviceOf: what the phone tells the computer about itself in `pair`.
// ─────────────────────────────────────────────────────────────────────────────

/** A Galaxy A26 WebView. */
const ANDROID =
  "Mozilla/5.0 (Linux; Android 15; SM-A266B Build/AP3A.240905.015.A2; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/129.0 Mobile Safari/537.36";

/** An iPhone WebView. */
const IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

describe("pairDeviceOf", () => {
  it("sends the engine, the build id, the UA model and the Android version", () => {
    expect(pairDeviceOf(BUILD, { ...PAGE_FLAGS, userAgent: ANDROID })).toEqual({
      engine: "0.14.12+9c41e0",
      build: "debug-20261014T160000Z",
      model: "SM-A266B",
      os: "Android 15"
    });
  });

  it("leaves out every key it has no value for", () => {
    const device = pairDeviceOf({ profile: "dev" }, PAGE_FLAGS);

    expect(device).toEqual({});
    expect(Object.keys(device)).toEqual([]);
  });

  it("takes the native shell's model before the UA's", () => {
    expect(
      pairDeviceOf({ profile: "read" }, { ...PAGE_FLAGS, model: "Pixel 9", userAgent: ANDROID })
    ).toEqual({ model: "Pixel 9", os: "Android 15" });
  });

  it("reports an iPhone as iOS, without a model", () => {
    expect(pairDeviceOf({ profile: "read" }, { ...PAGE_FLAGS, userAgent: IPHONE })).toEqual({
      os: "iOS 18"
    });
  });
});
