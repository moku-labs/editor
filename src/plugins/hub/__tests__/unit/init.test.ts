/* eslint-disable sonarjs/no-clear-text-protocols, sonarjs/no-hardcoded-ip -- config.allowOrigins cases are plain http and ftp origins; lanAddress values are the cases under test */
import { describe, expect, it } from "vitest";
import { validateHubConfig } from "../../init";
import type { HubConfig } from "../../types";
import { createCtx } from "../helpers";

/**
 * Runs the onInit body on a config.
 *
 * @param config - Fields to change.
 * @returns The ctx after init.
 */
function init(config: Partial<HubConfig>) {
  const ctx = createCtx(config);
  validateHubConfig(ctx);
  return ctx;
}

/**
 * A config value of a wrong type, as a JS caller could pass it.
 *
 * @param json - JSON of the fields.
 * @returns The fields.
 */
function loose(json: string): Partial<HubConfig> {
  return JSON.parse(json);
}

/** Spec/11 Part 3 error format with the editor prefix. */
const FORMAT = /^\[moku-editor] hub\.\w+ .+\.\n {2}.+\.$/;

describe("validateHubConfig", () => {
  it("accepts the defaults and builds no extra origins", () => {
    const ctx = init({});

    expect(ctx.state.origins.size).toBe(0);
  });

  it("builds state.origins from allowOrigins", () => {
    const ctx = init({ allowOrigins: ["http://192.168.1.4:3000", "https://dev.example.com"] });

    expect(ctx.state.origins).toEqual(
      new Set(["http://192.168.1.4:3000", "https://dev.example.com"])
    );
  });

  it("accepts nested paths", () => {
    expect(() => init({ path: "/tools/editor_1" })).not.toThrow();
    expect(() => init({ path: "/e" })).not.toThrow();
  });

  it("refuses bad paths in the spec/11 format", () => {
    for (const path of ["", "/", "editor", "/editor/", "/a//b", "/a b", "/a?x", "/é"]) {
      expect(() => init({ path })).toThrow(FORMAT);
      expect(() => init({ path })).toThrow(/^\[moku-editor] hub\.path /);
    }
    expect(() => init(loose('{"path":5}'))).toThrow(/^\[moku-editor] hub\.path /);
  });

  it("refuses allowOrigins entries that are not bare http(s) origins", () => {
    for (const entry of [
      "not a url",
      "ftp://x.com",
      "http://x.com/",
      "http://x.com/path",
      "HTTP://X.COM",
      "null",
      "file:///tmp"
    ]) {
      expect(() => init({ allowOrigins: [entry] })).toThrow(FORMAT);
      expect(() => init({ allowOrigins: [entry] })).toThrow(/^\[moku-editor] hub\.allowOrigins /);
    }
    expect(() => init(loose('{"allowOrigins":"http://x.com"}'))).toThrow(
      /^\[moku-editor] hub\.allowOrigins /
    );
    expect(() => init(loose('{"allowOrigins":[1]}'))).toThrow(/^\[moku-editor] hub\.allowOrigins /);
  });

  it("refuses timeouts that are not finite integers ≥ 100", () => {
    for (const value of [99, 0, -1, 100.5, Number.POSITIVE_INFINITY, Number.NaN]) {
      expect(() => init({ callTimeoutMs: value })).toThrow(/^\[moku-editor] hub\.callTimeoutMs /);
      expect(() => init({ silentAfterMs: value })).toThrow(/^\[moku-editor] hub\.silentAfterMs /);
    }
    expect(() => init({ callTimeoutMs: 100, silentAfterMs: 100 })).not.toThrow();
    expect(() => init(loose('{"callTimeoutMs":"5000"}'))).toThrow(FORMAT);
  });
});

describe("validateHubConfig: device mode (C1)", () => {
  /** The two-line format of a device-mode field: `hub.<field> is <value>.` and the rule. */
  const DEVICE_FORMAT = /^\[moku-editor] hub\.\w+ is .+\.\n {2}.+\.$/;

  it("builds state.deviceOrigins from the defaults and never adds them to state.origins", () => {
    const ctx = init({});

    expect(ctx.state.deviceOrigins).toEqual(
      new Set(["tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"])
    );
    expect(ctx.state.origins.size).toBe(0);
  });

  it("accepts tauri://localhost (bug: checking URL.origin, which is null for tauri:)", () => {
    expect(init({ deviceOrigins: ["tauri://localhost"] }).state.deviceOrigins).toEqual(
      new Set(["tauri://localhost"])
    );
  });

  it("refuses a deviceOrigins entry with a path, a trailing slash, another scheme or upper case", () => {
    for (const entry of [
      "tauri://localhost/",
      "tauri://localhost/app",
      "https://tauri.localhost/",
      "ftp://tauri.localhost",
      "TAURI://localhost",
      "tauri://LOCALHOST",
      "null",
      "not a url"
    ]) {
      expect(() => init({ deviceOrigins: [entry] })).toThrow(TypeError);
      expect(() => init({ deviceOrigins: [entry] })).toThrow(
        /^\[moku-editor] hub\.deviceOrigins is /
      );
      expect(() => init({ deviceOrigins: [entry] })).toThrow(DEVICE_FORMAT);
    }
    expect(() => init(loose('{"deviceOrigins":"tauri://localhost"}'))).toThrow(TypeError);
  });

  it("refuses a devicePort outside 0–65535 or not an integer", () => {
    for (const devicePort of [-1, 65_536, 1.5, Number.NaN]) {
      expect(() => init({ devicePort })).toThrow(TypeError);
      expect(() => init({ devicePort })).toThrow(/^\[moku-editor] hub\.devicePort is /);
    }
    expect(() => init(loose('{"devicePort":"47600"}'))).toThrow(DEVICE_FORMAT);
    expect(() => init({ devicePort: 0 })).not.toThrow();
    expect(() => init({ devicePort: 65_535 })).not.toThrow();
  });

  it("refuses a deviceLan that is not a boolean, a pairing that is not lan or always, a short pairTimeoutMs", () => {
    expect(() => init(loose('{"deviceLan":"yes"}'))).toThrow(
      /^\[moku-editor] hub\.deviceLan is "yes"\./
    );
    expect(() => init(loose('{"pairing":"never"}'))).toThrow(
      /^\[moku-editor] hub\.pairing is "never"\./
    );
    for (const pairTimeoutMs of [999, 1500.5, -1]) {
      expect(() => init({ pairTimeoutMs })).toThrow(/^\[moku-editor] hub\.pairTimeoutMs is /);
    }
    expect(() => init({ pairTimeoutMs: 1000, pairing: "always", deviceLan: true })).not.toThrow();
    expect(() => init(loose('{"pairing":"never"}'))).toThrow(TypeError);
  });

  it("refuses a lanAddress that is not an IP literal and accepts IPv4, IPv6 or none", () => {
    for (const lanAddress of ["my-pc.local", "192.168.1.300", ""]) {
      expect(() => init({ lanAddress })).toThrow(TypeError);
      expect(() => init({ lanAddress })).toThrow(DEVICE_FORMAT);
    }
    expect(() => init(loose('{"lanAddress":5}'))).toThrow(/^\[moku-editor] hub\.lanAddress is 5\./);
    for (const lanAddress of ["192.168.1.5", "::1", "fe80::1", undefined]) {
      expect(() => init({ lanAddress })).not.toThrow();
    }
  });

  it("refuses an IPv6 lanAddress that is not canonical lower case or carries a zone id (bug: a LAN Host that never matches)", () => {
    for (const lanAddress of ["FE80::1", "fe80::1%en0", "0:0:0:0:0:0:0:1", "2001:DB8::1"]) {
      expect(() => init({ lanAddress })).toThrow(TypeError);
      expect(() => init({ lanAddress })).toThrow(DEVICE_FORMAT);
      expect(() => init({ lanAddress })).toThrow(/^\[moku-editor] hub\.lanAddress is /);
    }
    expect(() => init({ lanAddress: "FE80::1" })).toThrow(/"fe80::1"/);
  });
});
