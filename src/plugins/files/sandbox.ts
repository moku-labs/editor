/**
 * @file files plugin — the one path resolver. Lexical rules first (no file-system call), then
 * deny, allow and the operation rules on the requested path, then the real path (target or
 * nearest existing ancestor) must stay under rootReal and pass the same rules, then the target
 * kind must fit the operation. Async for the api, sync for `resolve`.
 */
import type { Stats } from "node:fs";
import { realpathSync, statSync } from "node:fs";
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path/posix";
import type { FileEntry } from "../registry/protocol";
import { isImagePath } from "./binary";
import { forbidden, ioFailed, notFound } from "./errors";
import { MAX_PATH_LENGTH } from "./io";
import type { FileOperation, FilesCtx } from "./types";

/**
 * The only folder writeBinary may write into.
 */
const CAPTURES = ".moku/captures/";

/**
 * A drive-like start: `C:/x`, `c:x`.
 */
const DRIVE = /^[A-Za-z]:/;

/**
 * Operations that may target a file that does not exist yet.
 */
const WRITES: ReadonlySet<FileOperation> = new Set(["write", "writeBinary"]);

/**
 * One place to look for the real path: an absolute candidate and the segments below it.
 */
type Candidate = { readonly absolute: string; readonly rest: readonly string[] };

/**
 * Where a requested path lands on disk.
 */
type Located = {
  /** The real path of the target, or of its nearest ancestor joined with the missing segments. */
  readonly real: string;
  /** Whether the target itself exists. */
  readonly exists: boolean;
  /** The real path of the nearest existing ancestor (the target itself when it exists). */
  readonly ancestor: string;
};

/**
 * True when a list call names the root (`""` or `"."`).
 *
 * @param path - The requested path.
 * @param operation - The operation.
 * @returns Whether the path is the root form of list.
 * @example
 * ```ts
 * isRootForm(".", "list"); // true
 * ```
 */
function isRootForm(path: string, operation: FileOperation): boolean {
  return operation === "list" && (path === "" || path === ".");
}

/**
 * Rejects a path by its text alone, before any file-system call. No decoding happens.
 *
 * @param path - The requested path.
 * @param operation - The operation; only list accepts `""` and `"."` (the root).
 * @throws {Error} -32004 `forbidden_path` for a non-string, an empty or over-long path, NUL,
 * backslash, absolute or drive-like paths and any empty, `.` or `..` segment.
 * @example
 * ```ts
 * checkLexical("src/../x.ts", "read"); // throws "[moku-editor] forbidden path: src/../x.ts"
 * ```
 */
export function checkLexical(path: string, operation: FileOperation): void {
  if (typeof path !== "string") throw forbidden(String(path));
  if (isRootForm(path, operation)) return;

  const bad =
    path.length === 0 ||
    path.length > MAX_PATH_LENGTH ||
    path.includes("\0") ||
    path.includes("\\") ||
    path.startsWith("/") ||
    DRIVE.test(path) ||
    path.split("/").some(segment => segment === "" || segment === "." || segment === "..");

  if (bad) throw forbidden(path);
}

/**
 * True when the lowercased path, or any of its folder prefixes, matches a deny glob.
 *
 * @param relative - Relative posix path; `""` (the root) is never denied.
 * @param deny - The compiled deny globs.
 * @returns Whether the path is denied.
 * @example
 * ```ts
 * isDenied("packages/a/Node_Modules/b.ts", ctx.state.denyGlobs); // true
 * ```
 */
export function isDenied(relative: string, deny: readonly RegExp[]): boolean {
  let prefix = "";

  for (const segment of relative.toLowerCase().split("/")) {
    if (segment === "") continue;
    prefix = prefix === "" ? segment : `${prefix}/${segment}`;
    const candidate = prefix;
    if (deny.some(glob => glob.test(candidate))) return true;
  }

  return false;
}

/**
 * True when the path matches at least one allow glob (case-sensitive).
 *
 * @param relative - Relative posix path of a file.
 * @param allow - The compiled allow globs.
 * @returns Whether the file may be read or written.
 * @example
 * ```ts
 * isAllowed("src/a.ts", ctx.state.allowGlobs); // true with the default allow list
 * ```
 */
export function isAllowed(relative: string, allow: readonly RegExp[]): boolean {
  return allow.some(glob => glob.test(relative));
}

/**
 * True when a real path is the root or below it.
 *
 * @param rootReal - The real root.
 * @param real - A real absolute path.
 * @returns Whether the path stays inside the sandbox.
 * @example
 * ```ts
 * isInside("/game", "/game-other/a.ts"); // false
 * ```
 */
export function isInside(rootReal: string, real: string): boolean {
  return real === rootReal || real.startsWith(rootReal.endsWith("/") ? rootReal : `${rootReal}/`);
}

/**
 * The relative posix path of a real path inside the root (`""` for the root itself).
 *
 * @param rootReal - The real root.
 * @param real - A real absolute path for which isInside holds.
 * @returns The path relative to the root.
 * @example
 * ```ts
 * relativeTo("/game", "/game/src/a.ts"); // "src/a.ts"
 * ```
 */
export function relativeTo(rootReal: string, real: string): string {
  if (real === rootReal) return "";

  return real.slice(rootReal.endsWith("/") ? rootReal.length : rootReal.length + 1);
}

/**
 * Deny, allow and the image rules of an operation, on one relative path.
 *
 * @param ctx - Domain context of files.
 * @param relative - The requested or the real relative path.
 * @param operation - The operation.
 * @param requested - The requested path, for the error message.
 * @throws {Error} -32004 when any rule fails.
 * @example
 * ```ts
 * checkRules(ctx, "src/a.js", "read", "src/a.js"); // throws, not allowed
 * ```
 */
function checkRules(
  ctx: FilesCtx,
  relative: string,
  operation: FileOperation,
  requested: string
): void {
  if (isDenied(relative, ctx.state.denyGlobs)) throw forbidden(requested);
  if (operation === "list") return;

  const fails =
    !isAllowed(relative, ctx.state.allowGlobs) ||
    ((operation === "readBinary" || operation === "writeBinary") && !isImagePath(relative)) ||
    (operation === "writeBinary" && !relative.startsWith(CAPTURES));

  if (fails) throw forbidden(requested);
}

/**
 * Lexical rules, the init guard and the rules on the requested path.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested path.
 * @param operation - The operation.
 * @returns The relative path (`""` for the root form of list).
 * @throws {Error} -32004 on a rule, -32000 before init.
 * @example
 * ```ts
 * precheck(ctx, ".", "list"); // ""
 * ```
 */
function precheck(ctx: FilesCtx, path: string, operation: FileOperation): string {
  checkLexical(path, operation);
  if (ctx.state.rootReal === "") throw ioFailed("files: root used before init");

  const relative = isRootForm(path, operation) ? "" : path;
  checkRules(ctx, relative, operation, path);

  return relative;
}

/**
 * The target, then each ancestor up to the root, as realpath candidates.
 *
 * @param rootReal - The real root.
 * @param relative - The requested relative path.
 * @returns Candidates from the deepest to the root.
 * @example
 * ```ts
 * candidates("/game", "a/b"); // [{ "/game/a/b", [] }, { "/game/a", ["b"] }, { "/game", ["a", "b"] }]
 * ```
 */
function candidates(rootReal: string, relative: string): Candidate[] {
  const segments = relative === "" ? [] : relative.split("/");
  const list: Candidate[] = [];

  for (let count = segments.length; count >= 0; count -= 1) {
    list.push({
      absolute: join(rootReal, ...segments.slice(0, count)),
      rest: segments.slice(count)
    });
  }

  return list;
}

/**
 * True for the errors that mean "this path does not exist".
 *
 * @param error - Anything thrown by a file-system call.
 * @returns Whether the error is ENOENT or ENOTDIR.
 * @example
 * ```ts
 * isMissing(Object.assign(new Error("x"), { code: "ENOENT" })); // true
 * ```
 */
export function isMissing(error: unknown): boolean {
  return (
    error instanceof Error &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/**
 * Builds the Located of a candidate whose realpath succeeded.
 *
 * @param candidate - The candidate.
 * @param real - Its real path.
 * @returns Where the requested path lands.
 * @example
 * ```ts
 * located({ absolute: "/game/a", rest: ["b"] }, "/game/a"); // { real: "/game/a/b", exists: false, … }
 * ```
 */
function located(candidate: Candidate, real: string): Located {
  return {
    real: candidate.rest.length === 0 ? real : join(real, ...candidate.rest),
    exists: candidate.rest.length === 0,
    ancestor: real
  };
}

/**
 * The real path must stay under the root and pass the rules again when it differs.
 *
 * @param ctx - Domain context of files.
 * @param target - Where the requested path lands.
 * @param relative - The requested relative path.
 * @param operation - The operation.
 * @param requested - The requested path, for the error message.
 * @throws {Error} -32004 on an escape or a failed rule.
 * @example
 * ```ts
 * checkReal(ctx, { real: "/etc/hosts", exists: true, ancestor: "/etc/hosts" }, "src/l.ts", "read", "src/l.ts");
 * ```
 */
function checkReal(
  ctx: FilesCtx,
  target: Located,
  relative: string,
  operation: FileOperation,
  requested: string
): void {
  const { rootReal } = ctx.state;
  if (!isInside(rootReal, target.real) || !isInside(rootReal, target.ancestor)) {
    throw forbidden(requested);
  }

  const realRelative = relativeTo(rootReal, target.real);
  if (realRelative !== relative) checkRules(ctx, realRelative, operation, requested);
}

/**
 * The operation type check: list needs a folder, every other operation a regular file.
 *
 * @param stats - Stats of the real target.
 * @param operation - The operation.
 * @param requested - The requested path, for the error message.
 * @throws {Error} -32004 on a mismatch.
 * @example
 * ```ts
 * checkKind(await stat(real), "read", "src"); // throws, a folder
 * ```
 */
function checkKind(stats: Stats, operation: FileOperation, requested: string): void {
  const fits = operation === "list" ? stats.isDirectory() : stats.isFile();
  if (!fits) throw forbidden(requested);
}

/**
 * Settles a missing target: reads fail with -32601, writes need a folder as nearest ancestor.
 *
 * @param target - Where the requested path lands (exists is false).
 * @param ancestorIsFolder - Whether the nearest existing ancestor is a folder.
 * @param operation - The operation.
 * @param requested - The requested path, for the error message.
 * @returns The would-be real path of the write.
 * @throws {Error} -32601 for a read, -32004 when the ancestor is a file.
 * @example
 * ```ts
 * missingTarget(target, true, "write", "src/new.ts"); // "/game/src/new.ts"
 * ```
 */
function missingTarget(
  target: Located,
  ancestorIsFolder: boolean,
  operation: FileOperation,
  requested: string
): string {
  if (!WRITES.has(operation)) throw notFound(requested);
  if (!ancestorIsFolder) throw forbidden(requested);

  return target.real;
}

/**
 * Finds the real path of the target or of its nearest existing ancestor.
 *
 * @param rootReal - The real root.
 * @param relative - The requested relative path.
 * @param requested - The requested path, for the error message.
 * @returns Where the requested path lands.
 * @throws {Error} -32601 when even the root is gone; other fs errors pass through.
 * @example
 * ```ts
 * await locate("/game", "src/new.ts", "src/new.ts");
 * ```
 */
async function locate(rootReal: string, relative: string, requested: string): Promise<Located> {
  for (const candidate of candidates(rootReal, relative)) {
    try {
      return located(candidate, await realpath(candidate.absolute));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  throw notFound(requested);
}

/**
 * Sync twin of locate, for `resolve`.
 *
 * @param rootReal - The real root.
 * @param relative - The requested relative path.
 * @param requested - The requested path, for the error message.
 * @returns Where the requested path lands.
 * @throws {Error} -32601 when even the root is gone; other fs errors pass through.
 * @example
 * ```ts
 * locateSync("/game", "src/new.ts", "src/new.ts");
 * ```
 */
function locateSync(rootReal: string, relative: string, requested: string): Located {
  for (const candidate of candidates(rootReal, relative)) {
    try {
      return located(candidate, realpathSync(candidate.absolute));
    } catch (error) {
      if (!isMissing(error)) throw error;
    }
  }

  throw notFound(requested);
}

/**
 * The full sandbox check of one call; the absolute real path to operate on.
 *
 * @param ctx - Domain context of files.
 * @param path - The requested relative path.
 * @param operation - The operation.
 * @returns The real path of the target (or the would-be real path of a new file).
 * @throws {Error} -32004 on any rule, -32601 when a read target or a list folder is missing.
 * @example
 * ```ts
 * const real = await resolveReal(ctx, "src/a.ts", "read");
 * ```
 */
export async function resolveReal(
  ctx: FilesCtx,
  path: string,
  operation: FileOperation
): Promise<string> {
  const relative = precheck(ctx, path, operation);
  const target = await locate(ctx.state.rootReal, relative, path);
  checkReal(ctx, target, relative, operation, path);

  if (!target.exists) {
    const ancestor = await stat(target.ancestor);
    return missingTarget(target, ancestor.isDirectory(), operation, path);
  }

  checkKind(await stat(target.real), operation, path);
  return target.real;
}

/**
 * The full sandbox check, synchronously (realpathSync / statSync).
 *
 * @param ctx - Domain context of files.
 * @param path - The requested relative path.
 * @param operation - The operation.
 * @returns The real path of the target (or the would-be real path of a new file).
 * @throws {Error} -32004 on any rule, -32601 when a read target or a list folder is missing.
 * @example
 * ```ts
 * resolveRealSync(ctx, "src/main.ts", "write"); // "/Users/alex/game/src/main.ts"
 * ```
 */
export function resolveRealSync(ctx: FilesCtx, path: string, operation: FileOperation): string {
  const relative = precheck(ctx, path, operation);
  const target = locateSync(ctx.state.rootReal, relative, path);
  checkReal(ctx, target, relative, operation, path);

  if (!target.exists) {
    return missingTarget(target, statSync(target.ancestor).isDirectory(), operation, path);
  }

  checkKind(statSync(target.real), operation, path);
  return target.real;
}

/**
 * The list entry of one folder child, or undefined when the child must stay hidden: denied,
 * a dangling symlink, a symlink leaving the root, a file outside the allow list, or neither a
 * file nor a folder. Symlinks are listed with the kind of their target.
 *
 * @param ctx - Domain context of files.
 * @param child - Relative path of the child.
 * @param absolute - Absolute path of the child under the real folder.
 * @returns The entry, or undefined to skip the child.
 * @example
 * ```ts
 * await describeChild(ctx, "src/a.ts", "/game/src/a.ts"); // { path: "src/a.ts", kind: "file", size: 812 }
 * ```
 */
export async function describeChild(
  ctx: FilesCtx,
  child: string,
  absolute: string
): Promise<FileEntry | undefined> {
  const { rootReal, allowGlobs, denyGlobs } = ctx.state;
  if (isDenied(child, denyGlobs)) return undefined;

  let real: string;
  let stats: Stats;
  try {
    real = await realpath(absolute);
    stats = await stat(real);
  } catch {
    return undefined;
  }

  if (!isInside(rootReal, real)) return undefined;
  const realRelative = relativeTo(rootReal, real);
  if (isDenied(realRelative, denyGlobs)) return undefined;

  if (stats.isDirectory()) return { path: child, kind: "dir", size: 0 };

  const allowed = isAllowed(child, allowGlobs) && isAllowed(realRelative, allowGlobs);
  return stats.isFile() && allowed ? { path: child, kind: "file", size: stats.size } : undefined;
}
