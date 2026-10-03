/**
 * @file hub plugin — the per-start token and its timing-safe compare.
 */
import { Buffer } from "node:buffer";
import { randomBytes, timingSafeEqual } from "node:crypto";

/**
 * 32 random bytes, base64url (43 characters). Never logged.
 *
 * @returns A fresh token.
 * @example
 * ```ts
 * state.token = newToken();
 * ```
 */
export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Timing-safe compare; the byte lengths are checked first so timingSafeEqual never throws.
 *
 * @param given - The token of the request.
 * @param expected - The token of this start.
 * @returns Whether both are the same token.
 * @example
 * ```ts
 * if (!sameToken(query.get("token") ?? "", token)) return refuse(401, "unauthorized");
 * ```
 */
export function sameToken(given: string, expected: string): boolean {
  const left = Buffer.from(given, "utf8");
  const right = Buffer.from(expected, "utf8");

  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

/**
 * The token of this start.
 *
 * @param token - state.token.
 * @returns The token.
 * @throws {Error} Before start and after stop.
 * @example
 * ```ts
 * currentToken(state.token); // "Hk3…" (43 characters)
 * ```
 */
export function currentToken(token: string | undefined): string {
  if (token !== undefined) return token;

  throw new Error(
    "[moku-editor] hub.token() needs a started app.\n  Call await editor.start() first; the token changes on every start."
  );
}
