/**
 * @file workspace plugin — the other tools pages of this game (F106). Two tools tabs on one origin
 * drive one game, and its save lives in that origin's localStorage: a stale tab, its game still on
 * old code, keeps writing a save of the old shape, and the other tabs load it. Each tools page
 * says hello on a BroadcastChannel when it starts; a page that hears a hello answers, and both
 * show a toast that names the problem. A page without BroadcastChannel watches nothing.
 */
import type { ToastCtx } from "./toasts";
import { showToast } from "./toasts";

/**
 * The channel every tools page of an origin shares.
 */
export const PEERS_CHANNEL = "moku-editor:tools-pages";

/**
 * The toast a page shows when another tools page drives the same game.
 */
export const PEERS_TOAST =
  "Another editor tab drives this game and its save. Close one: a stale tab writes an old save over the new one.";

/**
 * A message of the channel: a page that starts says hello, a page that hears one answers here.
 */
type PeerMessage = { readonly kind: "hello" | "here"; readonly id: string };

/**
 * A random id of this page. `crypto.getRandomValues`, not `randomUUID`: a tools page opened at a
 * LAN address (`http://192.168.1.20:3000`) is no secure context, and there `randomUUID` is
 * missing.
 *
 * @returns 32 hex characters.
 */
function pageId(): string {
  const bytes = globalThis.crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, byte => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Whether a message of the channel is a peer message from another page.
 *
 * @param data - The message data.
 * @param id - This page's id.
 * @returns True for a hello or a here of another page.
 */
function isPeerMessage(data: unknown, id: string): data is PeerMessage {
  if (typeof data !== "object" || data === null) return false;
  const { kind, id: from } = data as Record<string, unknown>;
  return (kind === "hello" || kind === "here") && typeof from === "string" && from !== id;
}

/**
 * Starts watching for other tools pages (onStart): says hello once, answers every hello, and
 * shows the toast once for each other page it learns of.
 *
 * @param ctx - Config and state of workspace, for the toast.
 * @returns Closes the channel.
 * @example
 * ```ts
 * trackCleanup(state, watchPeers(ctx)); // a second tools tab of this game: both show PEERS_TOAST
 * ```
 */
export function watchPeers(ctx: ToastCtx): () => void {
  const Channel = globalThis.BroadcastChannel;
  if (typeof Channel !== "function") return () => {};

  const channel = new Channel(PEERS_CHANNEL);
  const id = pageId();
  const known = new Set<string>();

  // A hello asks the others to answer; every other page is named once.
  channel.addEventListener("message", event => {
    if (!isPeerMessage(event.data, id)) return;
    if (event.data.kind === "hello") channel.postMessage({ kind: "here", id });
    if (known.has(event.data.id)) return;
    known.add(event.data.id);
    showToast(ctx, PEERS_TOAST);
  });
  channel.postMessage({ kind: "hello", id });

  return () => {
    channel.close();
  };
}
