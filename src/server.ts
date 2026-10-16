// biome-ignore-all assist/source/organizeImports: sectioned entry (Framework API → Plugins → Types) is house style
/**
 * The `@moku-labs/editor/server` entry: the server core for Bun. Default plugins: files (the
 * project-root sandbox and the computer's engine fingerprint), hub (the websocket switchboard, and
 * the device listeners of `moku-editor perf`), collector (the device logs of `moku-editor perf`;
 * idle on a dev server) and pages (the tools page, its assets, the hello route and the bin).
 * `hub.serve()` wraps the game's `Bun.serve` options.
 *
 * Plugin options and their defaults, set through `pluginConfigs`:
 *
 * | Plugin | Option | Default |
 * |---|---|---|
 * | files | root | "." |
 * | files | allow | ["**\/*.ts", "**\/*.tsx", "**\/*.json", "**\/*.md", "**\/*.css", ".moku/**"] |
 * | files | deny | ["**\/node_modules/**", "**\/.git/**", "**\/dist/**", "**\/.env*"] |
 * | files | project | true: open the project index of root on start |
 * | hub | path | "/__editor" |
 * | hub | allowOrigins | [] |
 * | hub | callTimeoutMs | 5000 |
 * | hub | silentAfterMs | 6000 |
 * | hub | devicePort | 47600 |
 * | hub | deviceLan | false |
 * | hub | lanAddress | undefined: the first non-internal IPv4 of an en*, wl* or eth* interface |
 * | hub | deviceOrigins | ["tauri://localhost", "https://tauri.localhost", "http://tauri.localhost"] |
 * | hub | pairing | "lan": only a LAN phone is asked; an adb phone is confirmed at once |
 * | hub | pairTimeoutMs | 60000 |
 * | collector | out | ".moku/perf" |
 * | collector | everyS | 10 |
 * | collector | reverseEveryMs | 2000 |
 * | collector | adb | "adb" |
 * | collector | adbTimeoutMs | 5000 |
 * | collector | appId | undefined: no gfx lines |
 * | pages | title | "moku editor" |
 * | pages | editorUrl | "vscode://file/{path}:{line}" |
 * | pages | pageDir | undefined: dist/tools next to the module |
 * | pages | gameUrl | "/" |
 * | pages | toolsPage | true |
 *
 * The switches of `moku-editor perf` are not options of their own: `--port` is `hub.devicePort`,
 * `--lan` `hub.deviceLan`, `--out` `collector.out`, `--every` `collector.everyS`, `--no-ui`
 * `pages.toolsPage: false`.
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
import { collectorPlugin } from "./plugins/collector";
import { connectPlugin } from "./plugins/connect";
import { filesPlugin } from "./plugins/files";
import { hubPlugin } from "./plugins/hub";
import { pagesPlugin } from "./plugins/pages";

const framework = createServerCore(serverCoreConfig, {
  // Plugin order (D-03, spec 11 § 1): files ← hub ← connect ← collector ← pages. connect requires
  // hub (device mode, editor methods); collector is idle until hub's device listener reports a phone
  // (`hub:device`); pages depends on collector and hooks its per-plugin `collector:session` for the
  // perf CLI's live lines.
  plugins: [filesPlugin, hubPlugin, connectPlugin, collectorPlugin, pagesPlugin]
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
export { collectorPlugin } from "./plugins/collector";
export { connectPlugin } from "./plugins/connect";
export { filesPlugin } from "./plugins/files";
export { hubPlugin } from "./plugins/hub";
export { pagesPlugin } from "./plugins/pages";

// ─── Plugin Types (namespace re-exports) ──────────────────────
export * as Collector from "./plugins/collector/types";
export * as Connect from "./plugins/connect/types";
export * as Files from "./plugins/files/types";
export * as Hub from "./plugins/hub/types";
export * as Pages from "./plugins/pages/types";
