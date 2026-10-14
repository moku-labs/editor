/**
 * @file collector plugin — the computer mark route `{path}/perf/mark`: POST only, the hub's
 * same-origin guard, the hub token as a Bearer (compared timing-safe), the label as plain text
 * (at most 4 KiB read), `{"marked":<n>}` with no-store.
 */
import { timingSafeEqual } from "node:crypto";
import type { HubApi, RouteHandler } from "../hub/types";
import { labelOf, markLogs } from "./api";
import type { CollectorCtx } from "./types";

/** The most body bytes the route reads. */
export const MARK_BODY_MAX = 4096;

/** The scheme of the authorization header. */
const BEARER = "Bearer ";

/** The headers every answer of the route carries. */
const NO_STORE = { "cache-control": "no-store" };

/**
 * A plain-text answer.
 *
 * @param status - The status.
 * @param word - The body.
 * @param headers - Extra headers.
 * @returns The response.
 */
function textAnswer(status: number, word: string, headers: Record<string, string> = {}): Response {
  return new Response(word, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8", ...NO_STORE, ...headers }
  });
}

/**
 * A JSON answer.
 *
 * @param status - The status.
 * @param value - The body.
 * @returns The response.
 */
function jsonAnswer(status: number, value: { readonly [key: string]: string | number }): Response {
  return Response.json(value, { status, headers: NO_STORE });
}

/**
 * The hub token, or undefined before start and after stop (the hub throws then).
 *
 * @param hub - The hub api.
 * @returns The token.
 */
function tokenOf(hub: Pick<HubApi, "token">): string | undefined {
  try {
    return hub.token();
  } catch {
    return undefined;
  }
}

/**
 * Whether an authorization header carries the token: lengths first, then a timing-safe compare.
 *
 * @param header - The authorization header.
 * @param token - The hub token.
 * @returns Whether it matches.
 * @example
 * ```ts
 * isBearer("Bearer abc", "abc"); // true
 * ```
 */
function isBearer(header: string | null, token: string): boolean {
  const given = Buffer.from(header?.startsWith(BEARER) ? header.slice(BEARER.length) : "");
  const expected = Buffer.from(token);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * The body as text, reading at most `max` bytes.
 *
 * @param req - The request.
 * @param max - The most bytes read.
 * @returns The text, or undefined for a longer body.
 */
async function bodyOf(req: Request, max: number): Promise<string | undefined> {
  const reader = req.body?.getReader();
  if (reader === undefined) return "";

  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let read = await reader.read(); !read.done; read = await reader.read()) {
    size += read.value.byteLength;
    if (size > max) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(read.value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The mark route handler: guard, POST only (405), started (503), the hub token (401), a label of
 * 1–200 characters (400 `{"error":"label"}`), then the mark into every live log (200
 * `{"marked":<n>}`).
 *
 * @param ctx - Domain context of the collector.
 * @param hub - The hub api (guard and token).
 * @returns The handler.
 */
export function markRouteOf(ctx: CollectorCtx, hub: Pick<HubApi, "guard" | "token">): RouteHandler {
  return async (req, server) => {
    const refused = hub.guard(req, server, "same-origin");
    if (refused !== undefined) return refused;
    if (req.method !== "POST") return textAnswer(405, "method not allowed", { allow: "POST" });

    const token = tokenOf(hub);
    if (token === undefined) return textAnswer(503, "not started");
    if (!isBearer(req.headers.get("authorization"), token)) return textAnswer(401, "unauthorized");

    const label = labelOf(await bodyOf(req, MARK_BODY_MAX));
    if (label === undefined) return jsonAnswer(400, { error: "label" });

    return jsonAnswer(200, { marked: await markLogs(ctx, label) });
  };
}
