/**
 * @file hub plugin — the per-start token and its timing-safe compare.
 */

/**
 * 32 random bytes, base64url (43 characters). Never logged.
 *
 * @example
 * ```ts
 * state.token = newToken();
 * ```
 */
export function newToken(): string {
  throw new Error("not implemented");
}

/**
 * Timing-safe compare; the lengths are checked first so timingSafeEqual never throws.
 *
 * @param _given - The token of the request.
 * @param _expected - The token of this start.
 * @example
 * ```ts
 * if (!sameToken(query.get("token") ?? "", token)) return refuse(401);
 * ```
 */
export function sameToken(_given: string, _expected: string): boolean {
  throw new Error("not implemented");
}
