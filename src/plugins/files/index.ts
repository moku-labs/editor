/**
 * Standard tier — project-root sandbox: list, read, atomic write, capture write and image read
 * inside `root` (D-09). Emits the global server event `files:written`.
 *
 * @see README.md
 */
import { createServerPlugin } from "../../config";
import { createFilesApi } from "./api";
import { validateFilesConfig } from "./init";
import { createFilesState } from "./state";
import type { FilesConfig } from "./types";

const defaultConfig: FilesConfig = {
  root: ".",
  allow: ["**/*.ts", "**/*.tsx", "**/*.json", "**/*.md", "**/*.css", ".moku/**"],
  deny: ["**/node_modules/**", "**/.git/**", "**/dist/**", "**/.env*"]
};

/**
 * Files plugin — the only file-system door of the editor server.
 *
 * @example
 * ```ts
 * const editor = createApp({ pluginConfigs: { files: { root: `${import.meta.dir}/..` } } });
 * const entries = await editor.files.list("src");
 * ```
 */
export const filesPlugin = createServerPlugin("files", {
  config: defaultConfig,
  createState: createFilesState,
  api: createFilesApi,
  onInit: validateFilesConfig
});
