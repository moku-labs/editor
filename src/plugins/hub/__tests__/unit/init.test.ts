/* eslint-disable sonarjs/no-clear-text-protocols -- config.allow cases are plain http and ftp origins */
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

  it("builds state.origins from allow", () => {
    const ctx = init({ allow: ["http://192.168.1.4:3000", "https://dev.example.com"] });

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

  it("refuses allow entries that are not bare http(s) origins", () => {
    for (const entry of [
      "not a url",
      "ftp://x.com",
      "http://x.com/",
      "http://x.com/path",
      "HTTP://X.COM",
      "null",
      "file:///tmp"
    ]) {
      expect(() => init({ allow: [entry] })).toThrow(FORMAT);
      expect(() => init({ allow: [entry] })).toThrow(/^\[moku-editor] hub\.allow /);
    }
    expect(() => init(loose('{"allow":"http://x.com"}'))).toThrow(/^\[moku-editor] hub\.allow /);
    expect(() => init(loose('{"allow":[1]}'))).toThrow(/^\[moku-editor] hub\.allow /);
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
