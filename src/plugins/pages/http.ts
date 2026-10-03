/**
 * @file pages plugin — the small HTTP pieces the editor routes and the bin's static fetch share:
 * GET/HEAD responses (HEAD keeps the headers, drops the body), plain-text answers, the 405 with
 * `Allow`, path decoding and regular-file reads. No state, no log.
 */
import { readFile, stat } from "node:fs/promises";

/**
 * The methods every pages route answers.
 */
export const ALLOW = "GET, HEAD";

/**
 * Headers of every plain-text answer (errors, refusals, the 503 page).
 */
const TEXT_HEADERS: Readonly<Record<string, string>> = {
  "content-type": "text/plain; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff"
};

/**
 * True for GET and HEAD.
 *
 * @param req - The request.
 * @returns Whether the method reads.
 * @example
 * ```ts
 * isRead(new Request("http://127.0.0.1:3000/", { method: "HEAD" })); // true
 * ```
 */
export function isRead(req: Request): boolean {
  return req.method === "GET" || req.method === "HEAD";
}

/**
 * A response with the given body, or with no body for HEAD (same status and headers).
 *
 * @param req - The request (its method).
 * @param body - The GET body.
 * @param status - HTTP status.
 * @param headers - Response headers.
 * @returns The response.
 * @example
 * ```ts
 * const head = new Request("http://127.0.0.1:3000/", { method: "HEAD" });
 * await respond(head, "<html></html>", 200, {}).text(); // ""
 * ```
 */
export function respond(
  req: Request,
  body: string | Uint8Array<ArrayBuffer>,
  status: number,
  headers: Readonly<Record<string, string>>
): Response {
  return new Response(req.method === "HEAD" ? undefined : body, { status, headers });
}

/**
 * A plain-text answer, never cached.
 *
 * @param req - The request (its method).
 * @param status - HTTP status.
 * @param message - The body.
 * @param extra - Extra headers.
 * @returns The response.
 * @example
 * ```ts
 * textResponse(new Request("http://127.0.0.1:3000/x"), 404, "not found").headers.get("cache-control"); // "no-store"
 * ```
 */
export function textResponse(
  req: Request,
  status: number,
  message: string,
  extra: Readonly<Record<string, string>> = {}
): Response {
  return respond(req, message, status, { ...TEXT_HEADERS, ...extra });
}

/**
 * The 405 of a method other than GET and HEAD, with `Allow: GET, HEAD`.
 *
 * @param req - The request.
 * @returns The response.
 * @example
 * ```ts
 * methodNotAllowed(new Request("http://127.0.0.1:3000/", { method: "POST" })).headers.get("allow"); // "GET, HEAD"
 * ```
 */
export function methodNotAllowed(req: Request): Response {
  return textResponse(req, 405, "method not allowed", { allow: ALLOW });
}

/**
 * The 404 of every refused or missing file.
 *
 * @param req - The request.
 * @returns The response.
 * @example
 * ```ts
 * notFound(new Request("http://127.0.0.1:3000/x")).status; // 404
 * ```
 */
export function notFound(req: Request): Response {
  return textResponse(req, 404, "not found");
}

/**
 * The 400 of a malformed percent escape.
 *
 * @param req - The request.
 * @returns The response.
 * @example
 * ```ts
 * badRequest(new Request("http://127.0.0.1:3000/assets/%E0")).status; // 400
 * ```
 */
export function badRequest(req: Request): Response {
  return textResponse(req, 400, "bad request");
}

/**
 * decodeURIComponent that answers undefined for a malformed escape instead of throwing.
 *
 * @param text - The encoded path.
 * @returns The decoded path, or undefined.
 * @example
 * ```ts
 * decodePath("tile%201.png"); // "tile 1.png"
 * ```
 */
export function decodePath(text: string): string | undefined {
  try {
    return decodeURIComponent(text);
  } catch {
    return undefined;
  }
}

/**
 * The bytes of a regular file, or undefined when the path is missing or not a regular file.
 *
 * @param path - Absolute path.
 * @returns The file content, or undefined.
 * @example
 * ```ts
 * await readRegularFile("/game/missing.png"); // undefined
 * ```
 */
export async function readRegularFile(path: string): Promise<Uint8Array<ArrayBuffer> | undefined> {
  try {
    const info = await stat(path);
    if (!info.isFile()) return undefined;
    return new Uint8Array(await readFile(path));
  } catch {
    return undefined;
  }
}
