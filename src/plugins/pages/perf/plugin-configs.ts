/**
 * @file pages perf sub-domain — the plugin config of a perf run: every switch is a field of the
 * plugin that owns it (`hub.devicePort`, `hub.deviceLan`, `collector.out`, `collector.everyS`,
 * `pages.toolsPage`), so a later `moku-editor --device` reuses the same mapping. Pure.
 */
import type { PerfArgs, PerfPluginConfigs, ServerPluginConfigs } from "./types";

/**
 * The plugin config of a perf run: every switch is a field of the plugin that owns it.
 *
 * @param args - The run's arguments.
 * @param root - The absolute root (the files plugin's).
 * @param appId - The game's base Android identifier, or undefined (left out of the collector).
 * @returns The four plugin configs; `files.project` is false (no file watching while measuring).
 * @example
 * ```ts
 * perfConfigOf({ kind: "perf", lan: true, port: 47600, out: ".moku/perf", every: 10, ui: false }, "/game", "com.example.garden");
 * // { files: { root: "/game", project: false }, hub: { devicePort: 47600, deviceLan: true },
 * //   collector: { out: ".moku/perf", everyS: 10, appId: "com.example.garden" }, pages: { toolsPage: false } }
 * ```
 */
export function perfConfigOf(
  args: PerfArgs,
  root: string,
  appId: string | undefined
): PerfPluginConfigs {
  return {
    files: { root, project: false },
    hub: { devicePort: args.port, deviceLan: args.lan },
    collector: { out: args.out, everyS: args.every, ...(appId === undefined ? {} : { appId }) },
    pages: { toolsPage: args.ui }
  };
}

/**
 * Merges extra plugin configs over a perf run's, one plugin at a time: a field of `extra` wins,
 * every other field of `base` stays (a plain spread of the two objects would drop `collector.out`
 * when tests add `collector.adb`).
 *
 * @param base - The run's plugin configs.
 * @param extra - Extra plugin configs, or undefined.
 * @returns The merged `pluginConfigs` of the server createApp.
 * @example
 * ```ts
 * mergePluginConfigs({ collector: { out: ".moku/perf", everyS: 10 } }, { collector: { adb: "/no/adb" } });
 * // { collector: { out: ".moku/perf", everyS: 10, adb: "/no/adb" } }
 * ```
 */
export function mergePluginConfigs(
  base: PerfPluginConfigs,
  extra: ServerPluginConfigs | undefined
): ServerPluginConfigs {
  return {
    ...extra,
    files: { ...base.files, ...extra?.files },
    hub: { ...base.hub, ...extra?.hub },
    collector: { ...base.collector, ...extra?.collector },
    pages: { ...base.pages, ...extra?.pages }
  };
}
