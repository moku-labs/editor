/**
 * @file Framework configuration — three cores in one file (D-01): `editor-agent` for the game
 * page, `editor-server` for the Bun server and `editor-tools` for the tools page. Each core has
 * its own Config and global Events, and registers the core plugins `log` and `env`.
 */
import { envPlugin, logPlugin } from "@moku-labs/common/browser";
import { createCoreConfig } from "@moku-labs/core";
import type { FilesWritten } from "./plugins/files/types";
import type { HubSession } from "./plugins/hub/types";
import type { ElementRef } from "./plugins/panels/shared/scene/types";
import type { LinkStatus } from "./plugins/registry/protocol";
import type { RanEvent, WorkspaceId } from "./plugins/workspace/types";

/**
 * Global config of the agent core (the game page). Empty: every option belongs to a plugin.
 *
 * @example
 * ```ts
 * const config: AgentConfig = {};
 * ```
 */
export type AgentConfig = Record<never, never>;

/**
 * Global config of the server core (Bun). Empty: every option belongs to a plugin.
 */
export type ServerConfig = Record<never, never>;

/**
 * Global config of the tools core (the tools page). Empty: every option belongs to a plugin.
 */
export type ToolsConfig = Record<never, never>;

/**
 * Global events of the agent core. `bridge:status` lives here, not on the bridge, so the overlay
 * hooks it without depending on the opt-in bridge (R2).
 *
 * @example
 * ```ts
 * ctx.emit("bridge:status", { status: { kind: "live", frame: 12 }, session: "s-7f3a" });
 * ```
 */
export type AgentEvents = {
  /** The bridge link changed kind or session. */
  "bridge:status": { status: LinkStatus; session?: string };
};

/**
 * Global events of the server core (contracts §4).
 *
 * @example
 * ```ts
 * ctx.emit("files:written", { path: "nodes/merge.ts", bytes: 812, kind: "code" });
 * ```
 */
export type ServerEvents = {
  /** A game session opened (`open: true`) or closed (`open: false`, with a reason). */
  "hub:session": HubSession;
  /** A file was written inside the project root (text or capture). */
  "files:written": FilesWritten;
};

/**
 * Global events of the tools core (R4, R9): notices and one-way intents between the tools
 * plugins. Request/response stays in the plugin apis. No view depends on another view.
 *
 * @example
 * ```ts
 * ctx.emit("workspace:open-file", { path: "nodes/merge.ts", line: 12 });
 * ```
 */
export type ToolsEvents = {
  /** The link status or the chosen session changed. */
  "link:status": { status: LinkStatus; session?: string };
  /** The shown workspace changed. */
  "workspace:changed": { ws: WorkspaceId };
  /** A command run from the tools page settled (top bar, palette, key or a panel's tools.run). */
  "workspace:ran": RanEvent;
  /** Open a file in the Files workspace (filesView hooks it). */
  "workspace:open-file": { path: string; line?: number };
  /** Focus a node in the Flow workspace (flowView hooks it). */
  "workspace:select-node": { id: string };
  /** Focus the edge taken at a frame (flowView hooks it). */
  "workspace:focus-frame": { frame: number };
  /** Open the note editor, optionally with captures and a source node (flowView hooks it). */
  "workspace:new-note": {
    captures?: readonly string[];
    from?: { node: string; outcome?: string };
  };
  /** Select an element in the render tree (renderView hooks it). */
  "workspace:reveal": { ref: ElementRef };
  /** Inspect an element in the Game workspace (gameView hooks it, R9). */
  "workspace:inspect": { ref: ElementRef };
  /** Open a series contact sheet by its index.json path (gameView hooks it). */
  "workspace:open-sheet": { index: string };
};

/**
 * Public API type of a plugin instance, read from its phantom carrier. Mirrors the kernel's
 * non-exported `ExtractPluginApi`.
 *
 * @example
 * ```ts
 * type Link = ApiOf<typeof linkPlugin>; // the LinkApi type of src/plugins/link/types.ts
 * ```
 */
export type ApiOf<Plugin> = Plugin extends { readonly _phantom: { readonly api: infer PluginApi } }
  ? PluginApi
  : never;

/**
 * Structural type of `ctx.require`, for domain contexts that resolve their own dependencies. The
 * bound repeats the kernel's plugin shape, so the kernel's generic `require` is assignable to it.
 *
 * @example
 * ```ts
 * type WorkspaceCtx = { readonly require: Require };
 * ```
 */
export type Require = <
  Plugin extends {
    readonly name: string;
    readonly spec: unknown;
    readonly _phantom: {
      readonly config: unknown;
      readonly state: unknown;
      readonly api: unknown;
      readonly events: Record<string, unknown>;
    };
  }
>(
  plugin: Plugin
) => ApiOf<Plugin>;

/**
 * The core plugins every core registers: `ctx.log` and `ctx.env` on every plugin context.
 */
export type CorePlugins = [typeof logPlugin, typeof envPlugin];

const agentConfig: AgentConfig = {};
const serverConfig: ServerConfig = {};
const toolsConfig: ToolsConfig = {};

/**
 * Core config of the agent core (the game page).
 */
export const agentCoreConfig = createCoreConfig<AgentConfig, AgentEvents, CorePlugins>(
  "editor-agent",
  { config: agentConfig, plugins: [logPlugin, envPlugin] }
);

/**
 * Core config of the server core (Bun).
 */
export const serverCoreConfig = createCoreConfig<ServerConfig, ServerEvents, CorePlugins>(
  "editor-server",
  { config: serverConfig, plugins: [logPlugin, envPlugin] }
);

/**
 * Core config of the tools core (the tools page).
 */
export const toolsCoreConfig = createCoreConfig<ToolsConfig, ToolsEvents, CorePlugins>(
  "editor-tools",
  { config: toolsConfig, plugins: [logPlugin, envPlugin] }
);

/**
 * Creates an agent plugin bound to the agent core's Config and Events. Types infer from the spec.
 *
 * @example
 * ```ts
 * export const registryPlugin = createAgentPlugin("registry", { config, createState, api });
 * ```
 */
export const createAgentPlugin = agentCoreConfig.createPlugin;

/**
 * Creates a server plugin bound to the server core's Config and Events. Types infer from the spec.
 *
 * @example
 * ```ts
 * export const filesPlugin = createServerPlugin("files", { config, createState, api });
 * ```
 */
export const createServerPlugin = serverCoreConfig.createPlugin;

/**
 * Creates a tools plugin bound to the tools core's Config and Events. Types infer from the spec.
 *
 * @example
 * ```ts
 * export const linkPlugin = createToolsPlugin("link", { config, createState, api });
 * ```
 */
export const createToolsPlugin = toolsCoreConfig.createPlugin;

/**
 * Creates the agent framework from its core config. Used by `src/agent.ts` only.
 */
export const createAgentCore = agentCoreConfig.createCore;

/**
 * Creates the server framework from its core config. Used by `src/server.ts` only.
 */
export const createServerCore = serverCoreConfig.createCore;

/**
 * Creates the tools framework from its core config. Used by `src/tools.ts` only.
 */
export const createToolsCore = toolsCoreConfig.createCore;
