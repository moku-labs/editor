// biome-ignore-all assist/source/organizeImports: sectioned entry (Framework API → Plugins → Types) is house style
/**
 * The `@moku-labs/editor/server` entry: the server core for Bun. Default plugins: files (the
 * project-root sandbox), hub (the websocket switchboard) and pages (the tools page, its assets
 * and the hello route). `hub.serve()` wraps the game's `Bun.serve` options.
 *
 * Plugin options and their defaults, set through `pluginConfigs`:
 *
 * | Plugin | Option | Default |
 * |---|---|---|
 * | files | root | "." |
 * | files | allow | ["**\/*.ts", "**\/*.tsx", "**\/*.json", "**\/*.md", "**\/*.css", ".moku/**"] |
 * | files | deny | ["**\/node_modules/**", "**\/.git/**", "**\/dist/**", "**\/.env*"] |
 * | hub | path | "/__editor" |
 * | hub | allow | [] |
 * | hub | callTimeoutMs | 5000 |
 * | hub | silentAfterMs | 6000 |
 * | pages | title | "moku editor" |
 * | pages | editorUrl | "vscode://file/{path}:{line}" |
 * | pages | pageDir | undefined: dist/tools next to the module |
 * | pages | gameUrl | "/" |
 *
 * @file The Bun entry: the server core and its plugins.
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { files: { root: `${import.meta.dir}/..` } } });
 * await editor.start();
 * Bun.serve(editor.hub.serve({ port: 3000, routes: { "/": index }, fetch: serveAsset }));
 * ```
 */
import { createServerCore, serverCoreConfig } from "./config";
import { filesPlugin } from "./plugins/files";
import { hubPlugin } from "./plugins/hub";
import { pagesPlugin } from "./plugins/pages";

const framework = createServerCore(serverCoreConfig, {
  // Dependency order (D-03): files ← hub ← pages.
  plugins: [filesPlugin, hubPlugin, pagesPlugin]
});

// ─── Framework API ────────────────────────────────────────────
/**
 * Creates the editor server of a game.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { files: { root: "." } } });
 * ```
 */
export const createApp = framework.createApp;

/**
 * Creates a plugin for the server core, e.g. one that reacts to `files:written`.
 *
 * @example
 * ```ts
 * export const auditPlugin = createPlugin("audit", { hooks: createAuditHooks });
 * ```
 */
export const createPlugin = framework.createPlugin;

// ─── Plugins ──────────────────────────────────────────────────
export { filesPlugin } from "./plugins/files";
export { hubPlugin } from "./plugins/hub";
export { pagesPlugin } from "./plugins/pages";

// ─── Plugin Types (namespace re-exports) ──────────────────────
export * as Files from "./plugins/files/types";
export * as Hub from "./plugins/hub/types";
export * as Pages from "./plugins/pages/types";
