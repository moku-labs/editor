/**
 * @file link plugin — this page's own game frame session (spec 11 § 5.2): the newest open embedded
 * session whose page carries this page's frame id. The session pick prefers it (R7), and
 * activeSource pauses it while a device is the source. Pure: the list and the frame id in, the
 * session out.
 */
import type { SessionInfo } from "../../registry/protocol";
import { frameOf } from "./frame";

/**
 * The session with the largest `connectedAt` (the first of equals).
 *
 * @param list - Sessions.
 * @returns The newest, or undefined for none.
 * @example
 * ```ts
 * newest([
 *   { id: "a", game: "g", page: "/", embedded: false, connectedAt: 100 },
 *   { id: "b", game: "g", page: "/", embedded: false, connectedAt: 200 },
 *   { id: "c", game: "g", page: "/", embedded: true, connectedAt: 200 }
 * ])?.id; // "b": the first of the two newest
 * ```
 */
export function newest(list: readonly SessionInfo[]): SessionInfo | undefined {
  let best: SessionInfo | undefined;
  for (const session of list) {
    if (best === undefined || session.connectedAt > best.connectedAt) best = session;
  }
  return best;
}

/**
 * The own game frame session: the newest embedded session whose page carries `frame`. The game
 * frame of another tools tab carries another id; a frame URL opened outside an iframe is not
 * embedded. During a reload the new page's session is the newer one.
 *
 * @param list - The open sessions.
 * @param frame - The frame id of this tools page.
 * @returns The session, or undefined when the frame has none.
 * @example
 * ```ts
 * ownSessionOf(
 *   [
 *     { id: "s-1", game: "g", page: "http://127.0.0.1:3000/?__editorFrame=3f9a1c2b7d4e", embedded: true, connectedAt: 100 },
 *     { id: "s-2", game: "g", page: "http://127.0.0.1:3000/?__editorFrame=aaaaaaaaaaaa", embedded: true, connectedAt: 200 }
 *   ],
 *   "3f9a1c2b7d4e"
 * )?.id; // "s-1"
 * ```
 */
export function ownSessionOf(list: readonly SessionInfo[], frame: string): SessionInfo | undefined {
  return newest(list.filter(({ embedded, page }) => embedded && frameOf(page) === frame));
}
