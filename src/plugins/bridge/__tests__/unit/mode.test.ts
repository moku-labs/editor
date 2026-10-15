import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveMode } from "../../connection/device";
import { readFlags } from "../../pair-device";
import type { RememberedLinks } from "../../types";
import { DEFAULT_DEVICE_ADDRESS } from "../../types";
import { CONFIG, LAN, PAGE_FLAGS } from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// resolveMode: the four rows (first match wins) and the address precedence.
// ─────────────────────────────────────────────────────────────────────────────

/** Nothing remembered on the device. */
const NONE: RememberedLinks = { v: 1, last: undefined, links: {} };

/** The address the person paired last on the device. */
const REMEMBERED: RememberedLinks = { v: 1, last: "10.0.0.7:47600", links: {} };

/** The address `--editor` wrote into a debug build. */
const BUILT = "192.168.1.20:47600";

/** A dev page the dev server served. */
const DEV_PAGE = "http://127.0.0.1:3000/game.html";

/**
 * The input of resolveMode with overrides.
 *
 * @param input - Overrides.
 * @returns The input.
 */
function inputOf(input: Partial<Parameters<typeof resolveMode>[0]> = {}) {
  return { config: CONFIG, flags: PAGE_FLAGS, href: DEV_PAGE, remembered: NONE, ...input };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("resolveMode", () => {
  it("row 1: a debug build dials the address its build wrote", () => {
    expect(resolveMode(inputOf({ flags: { ...PAGE_FLAGS, editor: BUILT } }))).toEqual({
      mode: "device",
      address: BUILT
    });
  });

  it("row 1: the remembered address beats config.device, which beats the build's address", () => {
    const flags = { ...PAGE_FLAGS, editor: BUILT };
    const config = { ...CONFIG, device: LAN };

    expect(resolveMode(inputOf({ flags, config, remembered: REMEMBERED })).address).toBe(
      "10.0.0.7:47600"
    );
    expect(resolveMode(inputOf({ flags, config })).address).toBe(LAN);
  });

  it("row 1: a build address parseAddress refuses falls back to the default", () => {
    expect(resolveMode(inputOf({ flags: { ...PAGE_FLAGS, editor: "my_pc:47600" } }))).toEqual({
      mode: "device",
      address: DEFAULT_DEVICE_ADDRESS
    });
  });

  it("row 2: config.device sends a dev page to device mode, after the remembered address", () => {
    const config = { ...CONFIG, device: " My-PC.local:47600 " };

    expect(resolveMode(inputOf({ config }))).toEqual({
      mode: "device",
      address: "my-pc.local:47600"
    });
    expect(resolveMode(inputOf({ config, remembered: REMEMBERED })).address).toBe("10.0.0.7:47600");
  });

  it.each([
    "tauri://localhost/index.html",
    "http://tauri.localhost/index.html",
    "https://tauri.localhost/",
    "file:///data/game/index.html",
    undefined
  ])("row 3: a native page (%s) dials the default address", href => {
    expect(resolveMode(inputOf({ href }))).toEqual({
      mode: "device",
      address: DEFAULT_DEVICE_ADDRESS
    });
    expect(resolveMode(inputOf({ href, remembered: REMEMBERED })).address).toBe("10.0.0.7:47600");
  });

  it("row 3 needs a hello that does not name its server: a headless agent stays in page mode", () => {
    const config = { ...CONFIG, hello: "http://127.0.0.1:3000/__editor/hello" };

    expect(resolveMode(inputOf({ href: undefined, config }))).toEqual({
      mode: "page",
      address: undefined
    });
  });

  it("row 4: a page the dev server served stays in page mode", () => {
    expect(resolveMode(inputOf())).toEqual({ mode: "page", address: undefined });
    expect(resolveMode(inputOf({ href: "https://game.local:3000/" }))).toEqual({
      mode: "page",
      address: undefined
    });
    expect(resolveMode(inputOf({ remembered: REMEMBERED })).mode).toBe("page");
  });
});

describe("readFlags", () => {
  it("reads __MOKU_GAME_EDITOR__ when it is a non-empty string", () => {
    vi.stubGlobal("__MOKU_GAME_EDITOR__", BUILT);
    expect(readFlags(globalThis).editor).toBe(BUILT);

    vi.stubGlobal("__MOKU_GAME_EDITOR__", "");
    expect(readFlags(globalThis).editor).toBeUndefined();
    vi.stubGlobal("__MOKU_GAME_EDITOR__", 47_600);
    expect(readFlags(globalThis).editor).toBeUndefined();
  });

  it("reads the native shell's model and the user agent", () => {
    expect(
      readFlags({ __MOKU_NATIVE__: { model: "Pixel 9" }, navigator: { userAgent: "UA" } })
    ).toEqual({ editor: undefined, model: "Pixel 9", userAgent: "UA" });
    expect(readFlags({ __MOKU_NATIVE__: { model: 9 } })).toEqual(PAGE_FLAGS);
  });
});
