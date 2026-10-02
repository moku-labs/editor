import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateFilesConfig } from "../../init";
import { createFilesState } from "../../state";
import type { FilesConfig } from "../../types";
import type { TestCtx } from "../helpers";
import { createEmit, createLog, DEFAULT_CONFIG } from "../helpers";

let base: string;

beforeEach(async () => {
  base = await mkdtemp(join(tmpdir(), "moku-files-"));
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
});

/**
 * A ctx with a fresh state.
 *
 * @param config - Config overrides.
 * @returns The ctx.
 */
function ctxOf(config: Partial<FilesConfig>): TestCtx {
  return {
    config: { ...DEFAULT_CONFIG, ...config },
    state: createFilesState(),
    emit: createEmit(),
    log: createLog()
  };
}

describe("createFilesState", () => {
  it("starts with no root, no globs and no locks", () => {
    const state = createFilesState();
    expect(state).toEqual({ rootReal: "", allowGlobs: [], denyGlobs: [], locks: new Map() });
  });

  it("returns a fresh state per call", () => {
    expect(createFilesState().locks).not.toBe(createFilesState().locks);
  });
});

describe("validateFilesConfig", () => {
  it("stores the real root and compiles the globs", async () => {
    const ctx = ctxOf({ root: base });
    validateFilesConfig(ctx);
    expect(ctx.state.rootReal).toBe(await realpath(base));
    expect(ctx.state.allowGlobs).toHaveLength(6);
    expect(ctx.state.denyGlobs).toHaveLength(4);
    expect(ctx.state.denyGlobs.every(glob => glob.flags.includes("i"))).toBe(true);
    expect(ctx.state.allowGlobs.some(glob => glob.flags.includes("i"))).toBe(false);
  });

  it("resolves a relative root against the working folder", async () => {
    const ctx = ctxOf({ root: relative(process.cwd(), base) });
    validateFilesConfig(ctx);
    expect(ctx.state.rootReal).toBe(await realpath(base));
  });

  it("throws on an empty allow list", () => {
    const ctx = ctxOf({ root: base, allow: [] });
    expect(() => validateFilesConfig(ctx)).toThrow(
      "[moku-editor] files.allow is empty.\n  Pass at least one glob in pluginConfigs.files.allow."
    );
  });

  it("throws the formatted error on a missing root", () => {
    const root = join(base, "missing");
    expect(() => validateFilesConfig(ctxOf({ root }))).toThrow(
      `[moku-editor] files.root "${root}" is not a directory.\n  Pass pluginConfigs.files.root pointing at the game project.`
    );
  });
});
