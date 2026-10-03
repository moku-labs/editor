/**
 * @file pages plugin — the onInit body: validate config, resolve pageDir, build the routes and
 * register them with hub.addRoutes (R3). Must run in init: hub.serve() freezes routes after start.
 */
import { filesPlugin } from "../files";
import { hubPlugin } from "../hub";
import { pageDirCandidates, resolvePageDir } from "./page-dir";
import { createRoutes } from "./routes";
import type { PagesConfig, PagesCtx } from "./types";

/**
 * The longest accepted page title.
 */
const TITLE_MAX = 120;

/**
 * URL schemes an "Open in editor" link may never use: they run code in the tools page.
 */
const SCRIPT_SCHEMES: ReadonlySet<string> = new Set(["javascript", "data", "vbscript"]);

/**
 * A config error in the spec/11 Part 3 format with the editor prefix (R7).
 *
 * @param field - The config field.
 * @param problem - What is wrong, without the final period.
 * @param fix - How to fix it, without the final period.
 * @returns The error, ready to throw.
 * @example
 * ```ts
 * throw configError("title", "must not be empty", "Set pluginConfigs.pages.title");
 * ```
 */
function configError(field: keyof PagesConfig, problem: string, fix: string): Error {
  return new Error(`[moku-editor] pages.${field} ${problem}.\n  ${fix}.`);
}

/**
 * The scheme of a URL template as a browser reads it: lowercased, control characters dropped.
 *
 * @param url - The template.
 * @returns The text before the first `:`, or "" without one.
 * @example
 * ```ts
 * schemeOf(" JavaScript:alert(1)"); // "javascript"
 * ```
 */
function schemeOf(url: string): string {
  // A browser drops C0 controls and spaces (code points up to U+0020) before it reads the scheme.
  const clean = [...url].filter(char => (char.codePointAt(0) ?? 0) > 0x20).join("");
  const colon = clean.indexOf(":");
  return colon === -1 ? "" : clean.slice(0, colon).toLowerCase();
}

/**
 * Validates the pages config.
 *
 * @param config - The resolved config.
 * @throws {Error} `[moku-editor] pages.<field> …` for a bad title, editorUrl or gameUrl.
 */
export function validatePagesConfig(config: Readonly<PagesConfig>): void {
  const { title, editorUrl, gameUrl } = config;
  if (title.length === 0 || title.length > TITLE_MAX) {
    throw configError(
      "title",
      `must be 1-${TITLE_MAX} characters, got ${title.length}`,
      'Set pluginConfigs.pages.title to a short name such as "moku editor"'
    );
  }
  if (!editorUrl.includes("{path}")) {
    throw configError(
      "editorUrl",
      "must contain {path}",
      'Use a template such as "vscode://file/{path}:{line}"'
    );
  }
  if (SCRIPT_SCHEMES.has(schemeOf(editorUrl))) {
    throw configError(
      "editorUrl",
      `must not use the ${schemeOf(editorUrl)}: scheme`,
      'Use an editor scheme such as "vscode://file/{path}:{line}"'
    );
  }
  if (!gameUrl.startsWith("/") || gameUrl.startsWith("//") || gameUrl.includes("\\")) {
    throw configError(
      "gameUrl",
      "must be a same-origin path: start with / and not with // or contain \\",
      'Use a path on this server such as "/"'
    );
  }
}

/**
 * Validates config, resolves the page folder, creates the routes and calls hub.addRoutes.
 *
 * @param ctx - Domain context of pages.
 * @param candidates - Page folders tried when `pageDir` is not set (default: pageDirCandidates()).
 * @throws {Error} `[moku-editor] pages.<field> …` for a bad title, editorUrl or gameUrl.
 */
export function initPages(
  ctx: PagesCtx,
  candidates: readonly string[] = pageDirCandidates()
): void {
  const { config, state, log } = ctx;
  validatePagesConfig(config);

  state.pageDir = resolvePageDir(config.pageDir, candidates);
  if (state.pageDir === undefined) log.warn("pages:not-built", { tried: candidates });

  const hub = ctx.require(hubPlugin);
  const files = ctx.require(filesPlugin);
  state.routes = createRoutes({ hub, files, config, state, log });
  hub.addRoutes(state.routes);
}
