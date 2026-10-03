/**
 * @file files plugin — api factory: list, read, write, writeBinary, readBinary, resolve, root.
 * Thin: every call goes through the sandbox (sandbox.ts) and then the file-system helpers (io.ts).
 * Any error that is not already a wire error becomes -32000 naming the relative path only.
 */
import { realpath } from "node:fs/promises";
import { dirname } from "node:path/posix";
import type { FileBinary, FileEntry, FileText, WriteResult } from "../registry/protocol";
import { isWireError } from "../registry/protocol";
import { encodeDataUrl } from "./binary";
import { conflict, forbidden, invalid, ioFailed } from "./errors";
import {
  atomicWrite,
  listDir,
  MAX_BINARY_BYTES,
  MAX_TEXT_BYTES,
  readBytes,
  readText,
  sha1,
  withLock
} from "./io";
import { classifyWrite } from "./kind";
import { describeChild, isInside, isMissing, resolveReal, resolveRealSync } from "./sandbox";
import type { FilesApi, FilesCtx } from "./types";

/**
 * UTF-8 encoder of written text.
 */
const ENCODER = new TextEncoder();

/**
 * Turns anything a call threw into the error it rejects with: wire errors pass unchanged, any
 * other error becomes -32000 with the operation, the relative path and the errno code.
 *
 * @param operation - The api method.
 * @param path - The requested path.
 * @param error - What was thrown.
 * @returns The error to throw.
 * @example
 * ```ts
 * toFilesError("write", "src/a.ts", eacces).message; // "[moku-editor] write failed: src/a.ts (EACCES)"
 * ```
 */
function toFilesError(operation: string, path: string, error: unknown): Error {
  if (error instanceof Error && isWireError(error)) return error;

  const code =
    error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code
      : "EIO";

  return ioFailed(`${operation} failed: ${String(path)} (${code})`);
}

/**
 * Runs an async call and maps its failure with toFilesError.
 *
 * @param operation - The api method.
 * @param path - The requested path.
 * @param task - The call.
 * @returns The call's result.
 */
async function guard<T>(operation: string, path: string, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    throw toFilesError(operation, path, error);
  }
}

/**
 * Re-checks, right before the rename, that the target's folder is still the real folder the
 * sandbox resolved and still inside the root (narrows the symlink-swap window).
 *
 * @param ctx - Domain context of files.
 * @param real - The real target.
 * @param path - The requested path, for the error message.
 * @throws {Error} -32004 when the folder moved or left the root.
 */
async function recheckParent(ctx: FilesCtx, real: string, path: string): Promise<void> {
  const folder = dirname(real);
  const folderReal = await realpath(folder);

  if (folderReal !== folder || !isInside(ctx.state.rootReal, folderReal)) throw forbidden(path);
}

/**
 * Fires an emit that is not awaited. A throw, or a rejected promise the emit returns, goes to
 * `onFailure`, so a failing hook never breaks the caller.
 *
 * @param fire - Calls ctx.emit.
 * @param onFailure - Logs the failure.
 * @example
 * ```ts
 * emitLogged(() => Promise.reject(new Error("x")), console.error); // returns; logs "Error: x" later
 * ```
 */
function emitLogged(fire: () => unknown, onFailure: (error: unknown) => void): void {
  try {
    const emitted = fire();
    if (emitted instanceof Promise) emitted.catch(onFailure);
  } catch (error) {
    onFailure(error);
  }
}

/**
 * Writes the bytes atomically, announces the write and builds the result. The emit is not
 * awaited; a throw or a rejected promise of the emit is logged as `files:emit-failed`.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested path.
 * @param real - The real target.
 * @param bytes - The bytes to write.
 * @returns `{ path, bytes, version }`.
 */
async function commit(
  ctx: FilesCtx,
  path: string,
  real: string,
  bytes: Uint8Array
): Promise<WriteResult> {
  await atomicWrite(real, bytes, () => recheckParent(ctx, real, path));

  const payload = { path, bytes: bytes.length, kind: classifyWrite(path) };
  emitLogged(
    () => ctx.emit("files:written", payload),
    error => ctx.log.error("files:emit-failed", { path, error: String(error) })
  );

  return { path, bytes: bytes.length, version: sha1(bytes) };
}

/**
 * The optimistic concurrency check: the current bytes must hash to `version`.
 *
 * @param real - The real target.
 * @param path - The requested path.
 * @param version - The version the caller saw.
 * @throws {Error} -32005 when the file is missing or changed.
 */
async function checkVersion(real: string, path: string, version: string): Promise<void> {
  let current: Uint8Array;
  try {
    current = await readBytes(real, MAX_TEXT_BYTES, path);
  } catch (error) {
    if (isMissing(error)) throw conflict(path);
    throw error;
  }

  if (sha1(current) !== version) throw conflict(path);
}

/**
 * The body of `write`, run under the path's lock.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested path.
 * @param text - The new text.
 * @param version - Optional version the caller saw.
 * @returns The write result.
 */
async function writeText(
  ctx: FilesCtx,
  path: string,
  text: string,
  version: string | undefined
): Promise<WriteResult> {
  const real = await resolveReal(ctx, path, "write");
  if (version !== undefined) await checkVersion(real, path, version);
  if (typeof text !== "string") throw invalid("text", `write: text must be a string: ${path}`);

  const bytes = ENCODER.encode(text);
  if (bytes.length > MAX_TEXT_BYTES) throw invalid("text", `write: text over 2 MiB: ${path}`);

  return commit(ctx, path, real, bytes);
}

/**
 * The body of `writeBinary`, run under the path's lock.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested capture path.
 * @param bytes - The image bytes.
 * @returns The write result.
 */
async function writeImage(ctx: FilesCtx, path: string, bytes: Uint8Array): Promise<WriteResult> {
  const real = await resolveReal(ctx, path, "writeBinary");
  if (!(bytes instanceof Uint8Array)) {
    throw invalid("data", `writeBinary: data must be bytes: ${path}`);
  }
  if (bytes.length > MAX_BINARY_BYTES) {
    throw invalid("data", `writeBinary: data over 16 MiB: ${path}`);
  }

  return commit(ctx, path, real, bytes);
}

/**
 * The body of `readBinary`.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested image path.
 * @returns The data URL and the version.
 */
async function readImage(ctx: FilesCtx, path: string): Promise<FileBinary> {
  const bytes = await readBytes(await resolveReal(ctx, path, "readBinary"), MAX_BINARY_BYTES, path);

  return { dataUrl: encodeDataUrl(bytes, path), version: sha1(bytes) };
}

/**
 * The body of `list`.
 *
 * @param ctx - Domain context of files.
 * @param dir - The requested folder; `""` or `"."` for the root.
 * @returns The visible children.
 */
async function listFolder(ctx: FilesCtx, dir: string): Promise<FileEntry[]> {
  const real = await resolveReal(ctx, dir, "list");

  return listDir(dir === "." ? "" : dir, real, describeChild.bind(undefined, ctx));
}

/**
 * The body of `read`.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested path.
 * @returns The text and its version.
 */
async function readFile(ctx: FilesCtx, path: string): Promise<FileText> {
  return readText(await resolveReal(ctx, path, "read"), path);
}

/**
 * Creates the files api.
 *
 * @param ctx - Domain context of files.
 * @returns The api mounted at `app.files`.
 */
export function createFilesApi(ctx: FilesCtx): FilesApi {
  return {
    list: dir => guard("list", dir, () => listFolder(ctx, dir)),
    read: path => guard("read", path, () => readFile(ctx, path)),
    write: (path, text, version) =>
      guard("write", path, () =>
        withLock(ctx.state, path, () => writeText(ctx, path, text, version))
      ),
    writeBinary: (path, bytes) =>
      guard("writeBinary", path, () =>
        withLock(ctx.state, path, () => writeImage(ctx, path, bytes))
      ),
    readBinary: path => guard("readBinary", path, () => readImage(ctx, path)),
    resolve: path => {
      try {
        return resolveRealSync(ctx, path, "write");
      } catch (error) {
        throw toFilesError("resolve", path, error);
      }
    },
    root: () => ctx.state.rootReal
  };
}
