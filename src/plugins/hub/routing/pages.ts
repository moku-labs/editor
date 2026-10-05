/**
 * @file hub plugin — the editor page (D-33): a tools connection upgraded with `role=page`. Its
 * `selection` notification is checked and published (A5). `editor.select` is relayed to the page
 * that published the selection while it is open, else to the newest page (A7), under a hub id with
 * the select deadline (A6). A closing page fails its relayed calls (-32001 `page_closed`, A3); the
 * last one closing publishes `selection: null`. No page open: -32003 `no_editor_page`.
 */
import type { Json } from "../../registry/protocol";
import { errorCode, parseSelectionInfo, request, wireError } from "../../registry/protocol";
import { JSON_NULL, sendJson, strike, toolsConns } from "../sockets/send";
import type { HubCtx, HubState, Reply, ToolsConn } from "../types";
import { failPage, startCall } from "./calls";
import { publish } from "./publish";

/**
 * The address the editor binds, for the editor page URL.
 */
const LOOPBACK = "127.0.0.1";

/**
 * The URL of the editor page: `{path}/` on the loopback address and the server port, or the path
 * alone while no upgrade told the port.
 *
 * @param path - config.path.
 * @param port - The server port of the last accepted upgrade.
 * @returns The URL to open.
 * @example
 * ```ts
 * editorPageUrl("/__editor", 3000); // "http://127.0.0.1:3000/__editor/"
 * editorPageUrl("/__editor", undefined); // "/__editor/"
 * ```
 */
function editorPageUrl(path: string, port: number | undefined): string {
  const page = `${path}/`;
  return port === undefined ? page : `http://${LOOPBACK}:${port}${page}`;
}

/**
 * The -32003 error of a relay with no editor page open.
 *
 * @param url - The editor page URL.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw noEditorPage("http://127.0.0.1:3000/__editor/");
 * ```
 */
function noEditorPage(url: string): Error {
  return wireError(errorCode.noEditorPage, `no editor page is open. Open the editor page: ${url}`, {
    reason: "no_editor_page",
    retryable: false
  });
}

/**
 * Every open editor page connection, in connection order (the newest last).
 *
 * @param state - Hub state.
 * @returns The page connections.
 */
function pageConns(state: HubState): ToolsConn[] {
  return toolsConns(state).filter(conn => conn.page);
}

/**
 * The page a relayed call goes to: the one that published the selection while it is open, else
 * the newest page (A7).
 *
 * @param ctx - Domain context of the hub.
 * @returns The page connection.
 * @throws {Error} -32003 `no_editor_page` naming the editor page URL when no page is open.
 */
function choosePage(ctx: HubCtx): ToolsConn {
  const { state, config } = ctx;
  const pages = pageConns(state);
  const chosen = pages.find(conn => conn.conn === state.selectionConn) ?? pages.at(-1);
  if (chosen !== undefined) return chosen;

  throw noEditorPage(editorPageUrl(config.path, state.editorPort));
}

/**
 * Relays an editor-channel request to the chosen editor page under a new hub id, with the
 * deadline of the method. The page's answer settles back to `reply` like an agent's.
 *
 * @param ctx - Domain context of the hub.
 * @param method - The editor method, e.g. "select".
 * @param params - The checked params.
 * @param reply - Where the answer goes (the calling tools request).
 * @throws {Error} -32003 `no_editor_page` when no page is open; nothing is counted then.
 */
export function forwardToPage(ctx: HubCtx, method: string, params: Json, reply: Reply): void {
  const page = choosePage(ctx);
  const id = startCall(ctx, { kind: "page", conn: page.conn }, method, params, reply);

  sendJson(page, request(id, "editor", method, params));
}

/**
 * A page's `selection` notification: no params is nothing selected (`null`), a SelectionInfo is
 * kept without its unknown fields; either is published and the page is remembered as the one the
 * next `editor.select` goes to. Anything else is a strike.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The page connection.
 * @param params - The notification params.
 */
export function receiveSelection(ctx: HubCtx, conn: ToolsConn, params: Json | undefined): void {
  const info = params === undefined ? JSON_NULL : parseSelectionInfo(params);
  if (info === undefined) {
    strike(conn);
    return;
  }

  ctx.state.selectionConn = conn.conn;
  publish(ctx, "selection", info);
}

/**
 * A page connection closed (already forgotten): its relayed calls fail -32001 `page_closed`, it
 * stops being the selection's page, and when no page is left the selection becomes `null`.
 *
 * @param ctx - Domain context of the hub.
 * @param conn - The closed page connection.
 */
export function closePage(ctx: HubCtx, conn: ToolsConn): void {
  failPage(ctx, conn.conn);
  if (ctx.state.selectionConn === conn.conn) ctx.state.selectionConn = undefined;
  if (pageConns(ctx.state).length === 0) publish(ctx, "selection", JSON_NULL);
}
