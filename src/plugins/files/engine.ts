/**
 * @file files plugin — the engine fingerprint of the computer's project (C10): the installed
 * `@moku-labs/game` by the recipe of the engine's `__MOKU_GAME_ENGINE__` (engine spec 10 E2), step
 * for step, so a phone's fingerprint and the computer's compare. The walks read outside the
 * sandbox's allow list on purpose: fixed names read by the server itself (the installed package,
 * the lockfile folder), never a path a client sends, and nothing is exposed but the fingerprint.
 */
import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path/posix";
import type { EngineInfo } from "../hub/protocol";
import type { FilesCtx } from "./types";

/**
 * How long a computed fingerprint is answered again by `refreshEngine` without a new hash, in ms.
 */
export const ENGINE_REFRESH_MS = 2000;

/**
 * The fingerprint when the game is not installed under the root, or a read failed.
 */
export const UNKNOWN_ENGINE: EngineInfo = Object.freeze({
  id: "unknown",
  version: "unknown",
  dist: "unknown"
});

/**
 * The engine's package name.
 */
const GAME = "@moku-labs/game";

/**
 * The specifier the engine's dev server resolves (`hotPluginOf`): it lies under `dist/` in an
 * installed package and under `src/` in the engine's own repository.
 */
const HOT_PLUGIN = `${GAME}/hot`;

/**
 * The lockfiles that mark the install root, where the patch walk stops.
 */
const LOCKFILES: readonly string[] = ["bun.lock", "bun.lockb"];

/**
 * The hash of the recipe.
 */
const SHA256 = "sha256";

/**
 * Resolves a specifier from a folder, like `Bun.resolveSync`; throws when it is not found.
 */
export type Resolve = (specifier: string, from: string) => string;

/**
 * The runtime's resolver.
 *
 * @param specifier - The module specifier.
 * @param from - The folder it is resolved from.
 * @returns The absolute path.
 */
function bunResolve(specifier: string, from: string): string {
  return Bun.resolveSync(specifier, from);
}

/**
 * True for an error of a missing file or folder.
 *
 * @param error - What a read threw.
 * @returns Whether the path is absent.
 * @example
 * ```ts
 * isAbsent(Object.assign(new Error("no such file"), { code: "ENOENT" })); // true
 * ```
 */
function isAbsent(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/**
 * The fields of a folder's `package.json`, undefined when it has none. Any other read or parse
 * error is thrown (the fingerprint becomes unknown).
 *
 * @param folder - An absolute folder.
 * @returns The parsed fields.
 */
async function manifestOf(folder: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(join(folder, "package.json"), "utf8");
  } catch (error) {
    if (isAbsent(error)) return undefined;
    throw error;
  }

  const parsed: unknown = JSON.parse(text);
  return typeof parsed === "object" && parsed !== null ? { ...parsed } : {};
}

/**
 * Whether a file exists (a lockfile of the install root).
 *
 * @param file - An absolute path.
 * @returns Whether it can be read.
 */
async function exists(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if (isAbsent(error)) return false;
    throw error;
  }
}

/**
 * Walks up from a folder to the first one whose `package.json` names the game (step 2).
 *
 * @param start - The folder of the resolved hot plugin.
 * @returns The package folder and its manifest, or undefined.
 */
async function gameFolderOf(
  start: string
): Promise<{ folder: string; manifest: Record<string, unknown> } | undefined> {
  let folder = start;
  for (;;) {
    const manifest = await manifestOf(folder);
    if (manifest?.name === GAME) return { folder, manifest };

    const parent = dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

/**
 * Every file below a folder, recursively, as POSIX paths relative to it, sorted.
 *
 * @param root - An absolute folder.
 * @returns The relative file paths.
 */
async function filesBelow(root: string): Promise<string[]> {
  const found: string[] = [];
  const pending = [""];
  for (let folder = pending.pop(); folder !== undefined; folder = pending.pop()) {
    for (const entry of await readdir(join(root, folder), { withFileTypes: true })) {
      const path = folder === "" ? entry.name : `${folder}/${entry.name}`;
      if (entry.isDirectory()) pending.push(path);
      else if (entry.isFile()) found.push(path);
    }
  }
  return found.toSorted();
}

/**
 * The dist hash of step 4: SHA-256 (hex) over every file below the folder, in sorted POSIX
 * relative-path order, each fed as `<relative path>\0<bytes>\0`.
 *
 * @param dist - The package's `dist` folder.
 * @returns The hex digest.
 */
async function hashBuildFolder(dist: string): Promise<string> {
  const hash = createHash(SHA256);
  for (const path of await filesBelow(dist)) {
    hash.update(`${path}\0`);
    hash.update(await readFile(join(dist, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

/**
 * The patch of step 5: walking up from the root, the first `package.json` whose
 * `patchedDependencies` has `@moku-labs/game@<version>` gives the file (relative to its folder);
 * the walk stops after the first folder holding a lockfile, or at the top of the disk. A missing
 * file gives no patch.
 *
 * @param root - The project root.
 * @param version - The engine version.
 * @returns The absolute patch file and its SHA-256 (hex), or undefined.
 */
async function patchOf(
  root: string,
  version: string
): Promise<{ file: string; hash: string } | undefined> {
  const key = `${GAME}@${version}`;
  let folder = root;
  for (;;) {
    const manifest = await manifestOf(folder);
    const patched = manifest?.patchedDependencies;
    const declared =
      typeof patched === "object" && patched !== null ? Reflect.get(patched, key) : undefined;
    if (typeof declared === "string") return hashFile(resolve(folder, declared));

    const locked = await Promise.all(LOCKFILES.map(name => exists(join(folder, name))));
    const parent = dirname(folder);
    if (locked.includes(true) || parent === folder) return undefined;
    folder = parent;
  }
}

/**
 * A file and its SHA-256 (hex), or undefined when it is missing.
 *
 * @param file - An absolute path.
 * @returns The file and its hash.
 */
async function hashFile(file: string): Promise<{ file: string; hash: string } | undefined> {
  try {
    return {
      file,
      hash: createHash(SHA256)
        .update(await readFile(file))
        .digest("hex")
    };
  } catch (error) {
    if (isAbsent(error)) return undefined;
    throw error;
  }
}

/**
 * The fingerprint id of step 6: `<version>+<dist, 6 hex>` (`src` and `unknown` kept whole), plus
 * `.patch.<6 hex>` with a patch.
 *
 * @param version - The engine version.
 * @param dist - The dist hash, "src" or "unknown".
 * @param patchHash - The patch hash, when one is declared.
 * @returns The id.
 * @example
 * ```ts
 * engineId("0.14.12", "9c41e0aa…", "3f2a7b11…"); // "0.14.12+9c41e0.patch.3f2a7b"
 * ```
 */
function engineId(version: string, dist: string, patchHash: string | undefined): string {
  const build = dist === "src" || dist === "unknown" ? dist : dist.slice(0, 6);
  const patch = patchHash === undefined ? "" : `.patch.${patchHash.slice(0, 6)}`;
  return `${version}+${build}${patch}`;
}

/**
 * Fingerprints the engine installed under a root, by the engine's recipe (spec 10 E2): the hot
 * plugin resolved from the root, its package folder, the version, the hash of `dist` (or `src`),
 * the declared patch. The game not installed under the root, or no package of it found, gives
 * `unknown`. A failing read is thrown (the caller answers `unknown`). `patch.file` is relative to
 * the root when inside it, absolute otherwise.
 *
 * @param root - The project root (real path).
 * @param resolveFrom - The resolver (`Bun.resolveSync` by default).
 * @returns The frozen fingerprint.
 */
export async function engineOf(
  root: string,
  resolveFrom: Resolve = bunResolve
): Promise<EngineInfo> {
  let hotPlugin: string;
  try {
    hotPlugin = resolveFrom(HOT_PLUGIN, root);
  } catch {
    return UNKNOWN_ENGINE;
  }

  const game = await gameFolderOf(dirname(hotPlugin));
  if (game === undefined) return UNKNOWN_ENGINE;

  const { folder, manifest } = game;
  const version = typeof manifest.version === "string" ? manifest.version : "unknown";
  const distFolder = join(folder, "dist");
  const dist = hotPlugin.startsWith(`${distFolder}/`) ? await hashBuildFolder(distFolder) : "src";
  const patch = await patchOf(root, version);
  const id = engineId(version, dist, patch?.hash);
  if (patch === undefined) return Object.freeze({ id, version, dist });

  const inside = patch.file.startsWith(`${root}/`);
  const file = inside ? relative(root, patch.file) : patch.file;
  return Object.freeze({ id, version, dist, patch: Object.freeze({ file, hash: patch.hash }) });
}

/**
 * The fingerprint of the files root: `engineOf` with every failure answered `unknown` and logged
 * `files:engine-unknown` at debug, so the start never fails on it.
 *
 * @param ctx - Domain context of files.
 * @param resolveFrom - The resolver (`Bun.resolveSync` by default).
 * @returns The fingerprint.
 */
export async function computeEngine(
  ctx: FilesCtx,
  resolveFrom: Resolve = bunResolve
): Promise<EngineInfo> {
  try {
    return await engineOf(ctx.state.rootReal, resolveFrom);
  } catch (error) {
    ctx.log.debug("files:engine-unknown", { error: String(error) });
    return UNKNOWN_ENGINE;
  }
}
