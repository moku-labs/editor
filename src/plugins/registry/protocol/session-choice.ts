/**
 * @file Protocol — pickSession: the one session rule of a game request. The hub routes a tools
 * request by it and the MCP bridge names the game a tool means by it. Pure and isomorphic: no Node
 * or browser API.
 */

/**
 * The session a game request goes to: the asked id, else the only session, else the one embedded
 * session. An unknown asked id never falls back to another session.
 *
 * @param sessions - The open sessions, of any shape with an `id` and an `embedded` flag.
 * @param requested - The `session` the request names, if any.
 * @returns The session, or undefined when none fits or several do.
 * @example
 * ```ts
 * // The hub, on a tools request without a session: a game page and the game in the tools page.
 * pickSession([{ id: "s-1", embedded: false }, { id: "s-2", embedded: true }]);
 * // { id: "s-2", embedded: true }
 * pickSession([{ id: "s-1", embedded: false }], "s-9"); // undefined
 * ```
 */
export function pickSession<T extends { id: string; embedded: boolean }>(
  sessions: readonly T[],
  requested?: string
): T | undefined {
  if (requested !== undefined) return sessions.find(session => session.id === requested);

  const [only] = sessions;
  if (sessions.length === 1) return only;

  const embedded = sessions.filter(session => session.embedded);
  const [chosen] = embedded;
  return embedded.length === 1 ? chosen : undefined;
}
