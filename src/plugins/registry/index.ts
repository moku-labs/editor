/**
 * Complex tier — closure-erased entries for the game's doors, its .dev modules and the editor's
 * own commands and sources; builds the manifest (with the page's build) and probes the door and
 * editor sources at start and on each rebuild. Owns the runtime-free protocol module (./protocol).
 * Emits its own `registry:command` after every command run.
 *
 * @see README.md
 */
import type { RegisterFunction } from "@moku-labs/core";
import { createAgentPlugin } from "../../config";
import { createRegistryApi } from "./api";
import { buildCatalogue } from "./catalogue";
import { refreshManifest } from "./manifest";
import { createRegistryState } from "./state";
import type { RegistryCommandEvent, RegistryConfig } from "./types";

const defaultConfig: RegistryConfig = { game: undefined, modules: [], name: undefined };

/**
 * The agent registry: every source and command the editor can read, watch or run. Its event
 * `registry:command` reaches the plugins that depend on it.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game, modules: [mergeDev] } } });
 * editor.registry.manifest().sources.length; // 15 + the module's sources
 * ```
 */
export const registryPlugin = /* @__PURE__ */ createAgentPlugin("registry", {
  config: defaultConfig,
  // `register` is typed so the own event is known before the pre-typed api and onInit are checked
  // (spec 14 §10 row 8).
  events: (register: RegisterFunction) => ({
    "registry:command": register<RegistryCommandEvent>(
      "A command run settled: id, raw input, who ran it, whether it resolved"
    )
  }),
  createState: createRegistryState,
  api: createRegistryApi,
  onInit: buildCatalogue,
  onStart: refreshManifest
});
