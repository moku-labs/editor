/**
 * @file pages plugin — the bin's fetch for every path that is not a route: the game's own files
 * (manifest, tiles, sounds) from the project root. Guarded like a page (navigate), GET and HEAD
 * only, dotfiles and node_modules refused, and the real path must stay inside the real root.
 */
import { realpath, stat } from "node:fs/promises";
import { join } from "node:path/posix";
import type { GuardMode, HubServer } from "../hub/types";
import {
  badRequest,
  decodePath,
  isRead,
  methodNotAllowed,
  notFound,
  readRegularFile,
  respond
} from "./http";
import { contentType } from "./mime";

/**
 * The hub guard, as the bin passes it.
 */
type Guard = (req: Request, server: HubServer, mode: GuardMode) => Response | undefined;

/**
 * True for a relative path the bin may serve: no NUL, no backslash, no segment starting with
 * `.` (`..`, `.git`, `.env`, `.moku`) and no `node_modules` segment.
 *
 * @param relativePath - The decoded path without its leading slash.
 * @returns Whether the path may be served.
 * @example
 * ```ts
 * isServable("features/board/tile.png"); // true
 * ```
 */
function isServable(relativePath: string): boolean {
  if (relativePath.includes("\0") || relativePath.includes("\\")) return false;

  return relativePath
    .split("/")
    .every(segment => !segment.startsWith(".") && segment !== "node_modules");
}

/**
 * realpath that answers undefined for a missing path instead of throwing.
 *
 * @param path - Any path.
 * @returns The real path, or undefined.
 * @example
 * ```ts
 * await tryRealpath("/tmp"); // "/private/tmp" on macOS
 * ```
 */
async function tryRealpath(path: string): Promise<string | undefined> {
  try {
    return await realpath(path);
  } catch {
    return undefined;
  }
}

/**
 * The real path of a file, or undefined when it is missing or resolves outside the root.
 *
 * @param rootReal - The real root.
 * @param relativePath - The checked relative path.
 * @returns The real path, or undefined.
 * @example
 * ```ts
 * await realInside("/game", "manifest.json"); // "/game/manifest.json"
 * ```
 */
async function realInside(rootReal: string, relativePath: string): Promise<string | undefined> {
  const real = await tryRealpath(join(rootReal, relativePath));
  return real?.startsWith(`${rootReal}/`) ? real : undefined;
}

/** The dev manifest the page asks for next to it. */
const MANIFEST = "manifest.json";

/** Where `moku-game keys` writes the dev manifest since game 0.13 (game#45). */
const GENERATED_MANIFEST = "generated/manifest.json";

/**
 * Whether a real path is a regular file; false when it is gone or another kind of entry.
 *
 * @param path - A real path.
 * @returns True for a regular file.
 */
async function isFile(path: string): Promise<boolean> {
  return stat(path).then(
    entry => entry.isFile(),
    () => false
  );
}

/**
 * The real file a checked path answers with: `/manifest.json` comes from `generated/manifest.json`
 * when that file exists (game 0.13+), else from the root (older games); any other path is itself.
 *
 * @param rootReal - The real root.
 * @param relativePath - The checked relative path.
 * @returns The real path, or undefined.
 * @example
 * ```ts
 * await servedFile("/game", "manifest.json"); // "/game/generated/manifest.json" in a game 0.13 folder
 * ```
 */
async function servedFile(rootReal: string, relativePath: string): Promise<string | undefined> {
  if (relativePath === MANIFEST) {
    const generated = await realInside(rootReal, GENERATED_MANIFEST);
    if (generated !== undefined && (await isFile(generated))) return generated;
  }
  return realInside(rootReal, relativePath);
}

/**
 * The real root, resolved once; undefined when the root does not exist.
 *
 * @param root - The configured root.
 * @returns A function that resolves the real root.
 * @example
 * ```ts
 * await realRoot("/tmp")(); // "/private/tmp" on macOS
 * ```
 */
function realRoot(root: string): () => Promise<string | undefined> {
  let pending: Promise<string | undefined> | undefined;

  return function rootReal(): Promise<string | undefined> {
    pending ??= tryRealpath(root);
    return pending;
  };
}

/**
 * Creates the bin's fetch for the game's files under `root`. `/manifest.json` answers with
 * `generated/manifest.json` when the game has one (game 0.13+), else with the root's.
 *
 * @param root - The project root (`--root`).
 * @param guard - hub.guard: the navigate check runs first.
 * @returns A fetch handler for Bun.serve.
 * @example
 * ```ts
 * Bun.serve(editor.hub.serve({ port, routes: { "/": game.default }, fetch: createStaticFetch(root, editor.hub.guard) }));
 * ```
 */
export function createStaticFetch(
  root: string,
  guard: Guard
): (req: Request, server: HubServer) => Promise<Response> {
  const rootReal = realRoot(root);

  return async function serveStatic(req: Request, server: HubServer): Promise<Response> {
    const refused = guard(req, server, "navigate");
    if (refused) return refused;
    if (!isRead(req)) return methodNotAllowed(req);

    const relativePath = decodePath(new URL(req.url).pathname.slice(1));
    if (relativePath === undefined) return badRequest(req);
    if (!isServable(relativePath)) return notFound(req);

    const base = await rootReal();
    const real = base === undefined ? undefined : await servedFile(base, relativePath);
    const body = real === undefined ? undefined : await readRegularFile(real);
    if (body === undefined) return notFound(req);

    return respond(req, body, 200, {
      "content-type": contentType(relativePath),
      "cache-control": "no-cache",
      "x-content-type-options": "nosniff"
    });
  };
}
