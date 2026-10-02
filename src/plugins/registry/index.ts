/**
 * Complex tier — closure-erased entries for the game's doors, its .dev modules and the editor's
 * own commands; builds the manifest. Owns the runtime-free protocol module (./protocol).
 * Emits no events.
 *
 * @see README.md
 */
import { createAgentPlugin } from "../../config";
import { createRegistryApi } from "./api";
import { buildCatalogue } from "./catalogue";
import { createRegistryState } from "./state";
import type { RegistryConfig } from "./types";

const defaultConfig: RegistryConfig = { game: undefined, modules: [], name: undefined };

/**
 * The agent registry: every source and command the editor can read, watch or run.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { registry: { game, modules: [mergeDev] } } });
 * editor.registry.manifest().sources.length; // 14 + the module's sources
 * ```
 */
export const registryPlugin = createAgentPlugin("registry", {
  config: defaultConfig,
  createState: createRegistryState,
  api: createRegistryApi,
  onInit: buildCatalogue
});
