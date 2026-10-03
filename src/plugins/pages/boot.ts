/**
 * @file pages plugin — the boot JSON of the tools page (R1 ToolsBoot): built per request from hub,
 * files and config, and injected into the page template as
 * `<script type="application/json" id="moku-editor-boot">`. The token appears only there.
 */
import type { ToolsBoot } from "../registry/protocol";
import type { RouteDeps } from "./types";

/**
 * The first title element (lazy, any case).
 */
const TITLE = /(<title[^>]*>)[\s\S]*?(<\/title>)/i;

/**
 * The first end tag of the head (any case).
 */
const HEAD_END = /<\/head>/i;

/**
 * The websocket URL of the hub for a request: the Host the guard allowed, the hub path, `/ws`.
 * No query: link appends `?token=&kind=tools` (R1).
 *
 * @param req - The page or hello request.
 * @param path - hub.path().
 * @returns The ws URL.
 * @example
 * ```ts
 * wsUrlOf(req, "/__editor"); // "ws://127.0.0.1:3000/__editor/ws"
 * ```
 */
export function wsUrlOf(req: Request, path: string): string {
  const host = req.headers.get("host") ?? new URL(req.url).host;
  return `ws://${host}${path}/ws`;
}

/**
 * Builds the boot JSON of the tools page.
 *
 * @param req - The page request (its Host gives the ws URL).
 * @param deps - Hub, files and config.
 * @returns The ToolsBoot (R1): exactly its eight keys.
 * @throws {Error} When the hub has no token (before start, after stop).
 * @example
 * ```ts
 * buildBoot(req, deps).ws; // "ws://127.0.0.1:3000/__editor/ws"
 * ```
 */
export function buildBoot(req: Request, deps: RouteDeps): ToolsBoot {
  const { hub, files, config } = deps;
  const path = hub.path();

  return {
    v: 1,
    ws: wsUrlOf(req, path),
    token: hub.token(),
    path,
    title: config.title,
    editorUrl: config.editorUrl,
    root: files.root(),
    gameUrl: config.gameUrl
  };
}

/**
 * Puts the boot tag right before the first `</head>` and the escaped title into the first
 * `<title>`. Every other byte of the template stays as it was.
 *
 * @param template - index.html of the built page.
 * @param boot - The boot JSON.
 * @param title - The page title (escaped here).
 * @returns The page, or undefined when the template has no `</head>`.
 * @example
 * ```ts
 * injectBoot("<head><title>x</title></head>", boot, "moku editor");
 * ```
 */
export function injectBoot(template: string, boot: ToolsBoot, title: string): string | undefined {
  const titled = template.replace(TITLE, (_match, open: string, close: string) => {
    return `${open}${escapeHtml(title)}${close}`;
  });
  const end = titled.search(HEAD_END);
  if (end === -1) return undefined;

  const tag = `<script type="application/json" id="moku-editor-boot">${safeJson(boot)}</script>`;
  return `${titled.slice(0, end)}${tag}${titled.slice(end)}`;
}

/**
 * JSON.stringify with `<`, `>`, `&`, U+2028 and U+2029 escaped, so no value can close the
 * script element; JSON.parse still returns the same value.
 *
 * @param value - Any JSON value.
 * @returns The safe JSON text.
 * @example
 * ```ts
 * safeJson({ t: "</script>" }); // '{"t":"\\u003c/script\\u003e"}'
 * ```
 */
export function safeJson(value: unknown): string {
  return JSON.stringify(value).replaceAll(/[<>&\u2028\u2029]/g, char => {
    return String.raw`\u` + (char.codePointAt(0) ?? 0).toString(16).padStart(4, "0");
  });
}

/**
 * Escapes `& < > " '` for text between tags or inside an attribute.
 *
 * @param text - Plain text.
 * @returns The escaped text.
 * @example
 * ```ts
 * escapeHtml("<b>"); // "&lt;b&gt;"
 * ```
 */
export function escapeHtml(text: string): string {
  return text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
