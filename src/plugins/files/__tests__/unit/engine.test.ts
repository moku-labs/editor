import { mkdir, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path/posix";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeEngine, engineOf, UNKNOWN_ENGINE } from "../../engine";
import { startFiles } from "../../lifecycle";
import type { Fixture } from "../helpers";
import {
  createFixture,
  fixtureDistHash,
  fixtureEngineId,
  GAME_PATCH,
  GAME_VERSION,
  putGame,
  sha256
} from "../helpers";

// ─────────────────────────────────────────────────────────────────────────────
// The computer's engine fingerprint (C10), by the recipe of engine spec 10 E2,
// on a temp root holding an installed @moku-labs/game fixture.
// ─────────────────────────────────────────────────────────────────────────────

let fx: Fixture;
let root: string;

beforeEach(async () => {
  fx = await createFixture();
  root = await realpath(fx.root);
});

afterEach(async () => {
  await fx.cleanup();
});

describe("engineOf", () => {
  it("computes the id the engine computes, byte for byte (bug: a recipe drift that makes every phone look STALE)", async () => {
    await putGame(root);

    const engine = await engineOf(root);

    expect(engine).toEqual({
      id: fixtureEngineId(),
      version: GAME_VERSION,
      dist: fixtureDistHash(),
      patch: { file: GAME_PATCH, hash: sha256("--- a\n+++ b\n") }
    });
    expect(engine.id).toMatch(/^0\.14\.12\+[\da-f]{6}\.patch\.[\da-f]{6}$/);
    expect(Object.isFrozen(engine)).toBe(true);
  });

  it("ignores a patch declared for another version", async () => {
    await putGame(root, { patchKey: "@moku-labs/game@0.14.11" });

    const engine = await engineOf(root);

    expect(engine.id).toBe(`${GAME_VERSION}+${fixtureDistHash().slice(0, 6)}`);
    expect("patch" in engine).toBe(false);
  });

  it("gives no patch when the declared file is missing", async () => {
    await putGame(root, { patchFile: false });

    const engine = await engineOf(root);
    expect(engine.patch).toBeUndefined();
  });

  it("stops the patch walk at the install root's lockfile", async () => {
    const project = join(root, "apps/game");
    await putGame(project, { patchKey: undefined });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ patchedDependencies: { [`@moku-labs/game@${GAME_VERSION}`]: GAME_PATCH } })
    );
    await mkdir(join(root, "patches"), { recursive: true });
    await writeFile(join(root, GAME_PATCH), "--- a\n+++ b\n");

    const engine = await engineOf(project);
    expect(engine.patch).toBeUndefined();
  });

  it("finds the patch of a parent folder up to the install root, with its file absolute", async () => {
    const project = join(root, "apps/game");
    await putGame(project, { patchKey: undefined, lockfile: false });
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({ patchedDependencies: { [`@moku-labs/game@${GAME_VERSION}`]: GAME_PATCH } })
    );
    await mkdir(join(root, "patches"), { recursive: true });
    await writeFile(join(root, GAME_PATCH), "--- a\n+++ b\n");
    await writeFile(join(root, "bun.lock"), "{}\n");

    const engine = await engineOf(project);

    expect(engine.patch).toEqual({ file: join(root, GAME_PATCH), hash: sha256("--- a\n+++ b\n") });
  });

  it("gives +src for a hot plugin under src/ and hashes nothing", async () => {
    await putGame(root, { patchKey: undefined });
    const game = join(root, "node_modules/@moku-labs/game");

    const engine = await engineOf(root, () => join(game, "src/hot.ts"));

    expect(engine).toEqual({ id: `${GAME_VERSION}+src`, version: GAME_VERSION, dist: "src" });
  });

  it("gives unknown when the game does not resolve, or no package of it is found above the hot plugin", async () => {
    const missing = await engineOf(root, () => {
      throw new Error("Cannot find package '@moku-labs/game'");
    });
    await mkdir(join(root, "stub/dist"), { recursive: true });
    const stub = await engineOf(root, () => join(root, "stub/dist/hot.mjs"));

    expect(missing).toBe(UNKNOWN_ENGINE);
    expect(stub).toBe(UNKNOWN_ENGINE);
  });

  it("reads a version that is not a string as unknown", async () => {
    await putGame(root, { patchKey: undefined });
    const manifest = join(root, "node_modules/@moku-labs/game/package.json");
    await writeFile(
      manifest,
      JSON.stringify({ name: "@moku-labs/game", version: 14, exports: { "./hot": "./dist/a.mjs" } })
    );

    const engine = await engineOf(root);
    expect(engine.id).toBe(`unknown+${fixtureDistHash().slice(0, 6)}`);
  });
});

describe("computeEngine and the start", () => {
  it("answers unknown on a failing read, logs it at debug, and the start does not fail", async () => {
    await putGame(root);
    // A package.json that is a folder: reading it fails with EISDIR, not ENOENT.
    const broken = join(root, "node_modules/@moku-labs/game/dist/package.json");
    await mkdir(broken, { recursive: true });

    await expect(
      startFiles({ ...fx.ctx, config: { ...fx.ctx.config, project: false } })
    ).resolves.toBeUndefined();

    expect(fx.api.engine()).toBe(UNKNOWN_ENGINE);
    expect(fx.ctx.log.debug).toHaveBeenCalledWith("files:engine-unknown", {
      error: expect.stringContaining("EISDIR")
    });
    expect(await computeEngine(fx.ctx)).toBe(UNKNOWN_ENGINE);
  });
});
