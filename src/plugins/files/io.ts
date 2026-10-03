/**
 * @file files plugin — file-system work on paths the sandbox already resolved: bounded reads,
 * the atomic write (temp file in the same folder, fsync, rename), folder listing, sha1 versions
 * and the per-path write lock. Node built-ins only.
 */
import { createHash, randomBytes } from "node:crypto";
import { mkdir, open, readdir, rename, rm, stat } from "node:fs/promises";
import { basename, dirname, join } from "node:path/posix";
import type { FileEntry, FileText } from "../registry/protocol";
import { tooLarge } from "./errors";
import type { FilesState } from "./types";

/**
 * Longest accepted relative path, in UTF-16 code units.
 *
 * @example
 * ```ts
 * if (path.length > MAX_PATH_LENGTH) throw forbidden(path);
 * ```
 */
export const MAX_PATH_LENGTH = 1024;

/**
 * Largest image writeBinary writes and readBinary reads: 16 MiB.
 *
 * @example
 * ```ts
 * if (bytes.length > MAX_BINARY_BYTES) throw invalid("data", "…");
 * ```
 */
export const MAX_BINARY_BYTES = 16 * 1024 * 1024;

/**
 * Largest text file write writes and read reads: 2 MiB.
 *
 * @example
 * ```ts
 * if (bytes.length > MAX_TEXT_BYTES) throw invalid("text", "…");
 * ```
 */
export const MAX_TEXT_BYTES = 2 * 1024 * 1024;

/**
 * Mode of a file the write creates.
 */
const NEW_FILE_MODE = 0o644;

/**
 * UTF-8 decoder: invalid bytes become U+FFFD, a BOM stays in the text.
 */
const DECODER = new TextDecoder("utf-8", { ignoreBOM: true });

/**
 * Settles a lock tail whatever the task did.
 *
 * @returns Nothing.
 * @example
 * ```ts
 * run.then(settled, settled);
 * ```
 */
function settled(): undefined {
  return undefined;
}

/**
 * Lowercase hex sha1 of the bytes: the `version` of a file.
 *
 * @param bytes - The raw bytes.
 * @returns 40 hex characters.
 * @example
 * ```ts
 * sha1(new TextEncoder().encode("hello")); // "aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d"
 * ```
 */
export function sha1(bytes: Uint8Array): string {
  // eslint-disable-next-line sonarjs/hashing -- a content version (git-style), not a security hash
  return createHash("sha1").update(bytes).digest("hex");
}

/**
 * Reads a whole file, refusing it when it is larger than the limit.
 *
 * @param real - The real absolute path.
 * @param limit - Largest accepted size in bytes.
 * @param path - The requested relative path, for the error message.
 * @returns The bytes.
 * @throws {Error} -32000 `command_failed` when the file is over the limit.
 * @example
 * ```ts
 * const bytes = await readBytes(real, MAX_BINARY_BYTES, ".moku/captures/a.png");
 * ```
 */
export async function readBytes(real: string, limit: number, path: string): Promise<Uint8Array> {
  const handle = await open(real, "r");

  try {
    const { size } = await handle.stat();
    if (size > limit) throw tooLarge(path);

    const content = await handle.readFile();
    return new Uint8Array(content);
  } finally {
    await handle.close();
  }
}

/**
 * Reads a text file (up to 2 MiB) and its version.
 *
 * @param real - The real absolute path.
 * @param path - The requested relative path, for the error message.
 * @returns The UTF-8 text and the sha1 of the raw bytes.
 * @example
 * ```ts
 * const { text, version } = await readText(real, "src/a.ts");
 * ```
 */
export async function readText(real: string, path: string): Promise<FileText> {
  const bytes = await readBytes(real, MAX_TEXT_BYTES, path);

  return { text: DECODER.decode(bytes), version: sha1(bytes) };
}

/**
 * The permission bits of an existing file, or 0o644 for a new one.
 *
 * @param real - The real absolute path.
 * @returns The mode to give the written file.
 * @example
 * ```ts
 * await modeOf("/game/run.ts"); // 0o755
 * ```
 */
async function modeOf(real: string): Promise<number> {
  try {
    const stats = await stat(real);
    return stats.mode & 0o777;
  } catch {
    return NEW_FILE_MODE;
  }
}

/**
 * Writes bytes atomically: creates the missing parent folders, writes `.<name>.<hex>.tmp` in the
 * same folder (flag `wx`, the existing mode or 0o644), fsyncs, closes, runs `beforeRename`, then
 * renames onto the target. On any failure the temp file is removed and the error rethrown.
 *
 * @param real - The real absolute target (already resolved by the sandbox).
 * @param bytes - The bytes to write.
 * @param beforeRename - Optional last check, run right before the rename.
 * @example
 * ```ts
 * await atomicWrite(real, new TextEncoder().encode(text), () => recheckParent(real));
 * ```
 */
export async function atomicWrite(
  real: string,
  bytes: Uint8Array,
  beforeRename?: () => Promise<void>
): Promise<void> {
  const folder = dirname(real);
  await mkdir(folder, { recursive: true });

  const mode = await modeOf(real);
  const temporary = join(folder, `.${basename(real)}.${randomBytes(4).toString("hex")}.tmp`);

  try {
    const handle = await open(temporary, "wx", mode);
    try {
      await handle.writeFile(bytes);
      await handle.chmod(mode);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await beforeRename?.();
    await rename(temporary, real);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

/**
 * Orders folders before files, then by path with plain code-point comparison.
 *
 * @param left - One entry.
 * @param right - The other entry.
 * @returns A negative number when left comes first.
 * @example
 * ```ts
 * entries.toSorted(byKindThenPath);
 * ```
 */
function byKindThenPath(left: FileEntry, right: FileEntry): number {
  if (left.kind !== right.kind) return left.kind === "dir" ? -1 : 1;
  if (left.path === right.path) return 0;

  return left.path < right.path ? -1 : 1;
}

/**
 * Lists the direct children of a real folder; `describe` decides each child's entry.
 *
 * @param dir - The relative folder (`""` for the root).
 * @param real - Its real absolute path.
 * @param describe - The entry of a child (relative and absolute path), or undefined to skip it.
 * @returns Folders first, then files, each sorted by path.
 * @example
 * ```ts
 * await listDir("src", real, (child, absolute) => describeChild(ctx, child, absolute));
 * ```
 */
export async function listDir(
  dir: string,
  real: string,
  describe: (child: string, absolute: string) => Promise<FileEntry | undefined>
): Promise<FileEntry[]> {
  const names = await readdir(real);
  const entries = await Promise.all(
    names.map(name => describe(dir === "" ? name : `${dir}/${name}`, join(real, name)))
  );

  return entries.filter(entry => entry !== undefined).toSorted(byKindThenPath);
}

/**
 * Runs a task after every earlier task on the same path has settled.
 *
 * @param state - Files state (its `locks` map).
 * @param path - The relative path the lock is for.
 * @param task - The work to run under the lock.
 * @returns The task's result.
 * @example
 * ```ts
 * await withLock(ctx.state, "src/a.ts", () => writeText(ctx, "src/a.ts", text));
 * ```
 */
export async function withLock<T>(
  state: FilesState,
  path: string,
  task: () => Promise<T>
): Promise<T> {
  const previous = state.locks.get(path) ?? Promise.resolve();
  const run = previous.then(task);
  const tail = run.then(settled, settled);
  state.locks.set(path, tail);

  try {
    return await run;
  } finally {
    if (state.locks.get(path) === tail) state.locks.delete(path);
  }
}
