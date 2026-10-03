import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Require } from "../../../../config";
import { filesPlugin } from "../../../files";
import { hubPlugin } from "../../../hub";
import { initPages } from "../../init";
import { createPagesState } from "../../state";
import type { PagesConfig, PagesCtx } from "../../types";
import { createFiles, createHub, createLog, DEFAULT_CONFIG } from "../helpers";

let pageDir: string;

beforeEach(async () => {
  pageDir = await mkdtemp(join(tmpdir(), "moku-init-"));
  await writeFile(join(pageDir, "index.html"), "<head></head>");
});

afterEach(async () => {
  await rm(pageDir, { recursive: true, force: true });
});

/**
 * A pages ctx whose require returns a fake hub and files.
 *
 * @param config - Config overrides.
 * @returns The ctx and the fakes.
 */
function createCtx(config: Partial<PagesConfig> = {}) {
  const hub = createHub();
  const files = createFiles();
  const full: PagesConfig = { ...DEFAULT_CONFIG, pageDir, ...config };
  const require = vi.fn((plugin: unknown) => {
    if (plugin === hubPlugin) return hub;
    if (plugin === filesPlugin) return files;
    throw new Error("unexpected plugin");
  });
  const ctx: PagesCtx = {
    config: full,
    state: createPagesState({ config: full }),
    log: createLog(),
    require: require as unknown as Require
  };
  return { ctx, hub, files };
}

describe("initPages", () => {
  it("resolves the page folder, builds the routes and calls addRoutes once with four keys", () => {
    const { ctx, hub } = createCtx();
    initPages(ctx);
    expect(ctx.state.pageDir).toBe(pageDir);
    expect(hub.addRoutes).toHaveBeenCalledTimes(1);
    expect(hub.addRoutes).toHaveBeenCalledWith(ctx.state.routes);
    expect(Object.keys(ctx.state.routes)).toEqual([
      "/__editor",
      "/__editor/",
      "/__editor/hello",
      "/__editor/assets/*"
    ]);
  });

  it("accepts the defaults and safe editor schemes", () => {
    for (const editorUrl of [
      "cursor://file/{path}:{line}",
      "zed://file{path}",
      "idea://open?file={path}"
    ]) {
      expect(() => initPages(createCtx({ editorUrl }).ctx)).not.toThrow();
    }
  });

  it.each([
    ["title", { title: "" }],
    ["title", { title: "x".repeat(121) }],
    ["editorUrl", { editorUrl: "vscode://file/" }],
    ["editorUrl", { editorUrl: "javascript:alert(1)//{path}" }],
    ["editorUrl", { editorUrl: "  JavaScript:alert(1)//{path}" }],
    ["editorUrl", { editorUrl: "java\tscript:alert(1)//{path}" }],
    ["editorUrl", { editorUrl: "data:text/html,{path}" }],
    ["editorUrl", { editorUrl: "VBScript:x{path}" }],
    ["gameUrl", { gameUrl: "https://evil.com/" }],
    ["gameUrl", { gameUrl: "//evil.com" }],
    ["gameUrl", { gameUrl: String.raw`/\evil.com` }],
    ["gameUrl", { gameUrl: "" }]
  ])("P8/P9: refuses a bad %s (%j)", (field, config) => {
    const { ctx, hub } = createCtx(config);
    expect(() => initPages(ctx)).toThrow(
      new RegExp(String.raw`^\[moku-editor\] pages\.${field} .*\.\n  .*\.$`, "s")
    );
    expect(hub.addRoutes).not.toHaveBeenCalled();
  });

  it("accepts a 120-character title", () => {
    expect(() => initPages(createCtx({ title: "x".repeat(120) }).ctx)).not.toThrow();
  });

  it("warns pages:not-built once with the tried folders when nothing is built", () => {
    const { ctx } = createCtx({ pageDir: undefined });
    const missing = join(pageDir, "missing");
    initPages(ctx, [missing]);
    expect(ctx.state.pageDir).toBeUndefined();
    expect(ctx.log.warn).toHaveBeenCalledTimes(1);
    expect(ctx.log.warn).toHaveBeenCalledWith("pages:not-built", { tried: [missing] });
  });
});
