/**
 * @file The agent stack of the root integration wave (plan §2.4): the agent core from
 * `src/agent.ts` with bridge and capture over a started game, an agent probe that records
 * `bridge:status`, and `reloadAgent`, which plays "the game page reloaded".
 */
import type { AnyPluginInstance } from "@moku-labs/core";
import type { Registry } from "../../../src/agent";
import { bridgePlugin, capturePlugin, createApp, createPlugin } from "../../../src/agent";
import type { AgentEvents } from "../../../src/config";
import { currentPage } from "./page";
import type { ServerStack } from "./server-stack";
import { type StartedGame, TINY_NAME, tinyModule, withRenderer } from "./tiny-game";

/** The opt-in plugins of a game's dev entry. */
type OptIn = readonly [typeof bridgePlugin, typeof capturePlugin];

/** The pluginConfigs an agent stack takes, merged per plugin over the stack defaults. */
export type AgentConfigs = NonNullable<
  NonNullable<Parameters<typeof createApp<OptIn>>[0]>["pluginConfigs"]
>;

/** Options of `startAgent`. */
export type AgentOptions = {
  /** Leave bridge and capture out (B1, E2). The server may then be undefined. */
  readonly bare?: boolean;
  /** Hand the game a renderer that answers this data URL (`withRenderer`). */
  readonly png?: string;
  /** The game's dev modules. Default `[tinyModule]`. */
  readonly modules?: readonly Registry.DevModule[];
  /** `registry.name`. Default `TINY_NAME`. */
  readonly name?: string;
  /** Extra pluginConfigs, merged per plugin (e.g. `{ bridge: { callTimeoutMs: 300 } }`). */
  readonly configs?: AgentConfigs;
  /** Extra plugins after the probe (e.g. B2's `ping`). */
  readonly plugins?: readonly AnyPluginInstance[];
};

/**
 * The agent probe: a real agent plugin that records `bridge:status`.
 *
 * @param statuses - Where the payloads go.
 * @returns The plugin.
 */
function createAgentProbe(statuses: AgentEvents["bridge:status"][]) {
  return createPlugin("agentProbe", {
    hooks: () => ({
      "bridge:status": (payload: AgentEvents["bridge:status"]) => {
        statuses.push(payload);
      }
    })
  });
}

/**
 * Creates the agent app with bridge and capture (not started).
 *
 * @param extras - The probe and the extra plugins.
 * @param pluginConfigs - The full pluginConfigs, `registry.game` included.
 * @returns The app.
 */
function createFullApp(extras: readonly AnyPluginInstance[], pluginConfigs: AgentConfigs) {
  return createApp({ plugins: [bridgePlugin, capturePlugin, ...extras], pluginConfigs });
}

/**
 * Creates the agent app without bridge and capture (not started).
 *
 * @param extras - The probe and the extra plugins.
 * @param pluginConfigs - The full pluginConfigs, `registry.game` included.
 * @returns The app.
 */
function createBareApp(extras: readonly AnyPluginInstance[], pluginConfigs: AgentConfigs) {
  return createApp({ plugins: [...extras], pluginConfigs });
}

/** The agent app with bridge and capture. */
export type AgentApp = ReturnType<typeof createFullApp>;

/** The agent app without bridge and capture. */
export type BareAgentApp = ReturnType<typeof createBareApp>;

/** One running agent. */
export type AgentStack<App = AgentApp> = {
  readonly kind: "agent";
  readonly app: App;
  /** Every `bridge:status` payload, in order. */
  readonly statuses: AgentEvents["bridge:status"][];
  /** The game the agent serves. */
  readonly game: StartedGame;
  /** The server it links to, undefined for a bare agent. */
  readonly server: ServerStack | undefined;
  readonly options: AgentOptions;
  /** Stops the agent app (the game keeps running). */
  stop(): Promise<void>;
};

/** A running agent without bridge and capture. */
export type BareAgentStack = AgentStack<BareAgentApp>;

/**
 * The full pluginConfigs of one agent: stack defaults, then the test's configs per plugin.
 *
 * @param server - The server, or undefined.
 * @param game - The game app the registry serves.
 * @param options - The agent options.
 * @returns The pluginConfigs.
 */
function agentConfigs(
  server: ServerStack | undefined,
  game: Registry.GameLike,
  options: AgentOptions
): AgentConfigs {
  const configs = options.configs ?? {};
  const hello =
    server === undefined ? "/__editor/hello" : `${server.origin}${server.app.hub.path()}/hello`;
  return {
    ...configs,
    registry: {
      game,
      modules: options.modules ?? [tinyModule],
      name: options.name ?? TINY_NAME,
      ...configs.registry
    },
    channel: { heartbeatMs: 100, ...configs.channel },
    bridge: { hello, retryMs: 100, ...configs.bridge },
    overlay: { mount: "[data-game-page]", ...configs.overlay }
  };
}

/**
 * Starts an app, then checks that an installed page counts as embedded.
 *
 * @param app - The agent app.
 * @param app.start - Its start.
 * @param app.stop - Its stop.
 * @param app.registry - Its registry.
 * @param app.registry.manifest - The manifest.
 * @returns Resolves when started.
 * @throws {Error} When a page is installed and the manifest says `embedded: false`.
 */
async function startChecked(app: {
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly registry: { manifest(): { readonly embedded: boolean } };
}): Promise<void> {
  await app.start();
  if (currentPage() === undefined || app.registry.manifest().embedded) return;
  await app.stop().catch(() => undefined);
  throw new Error("the installed page does not count as embedded: manifest().embedded is false");
}

/**
 * Starts an agent with bridge and capture over a started game: `registry { game, modules, name }`,
 * `channel { heartbeatMs: 100 }`, `bridge { hello: <origin><hub path>/hello, retryMs: 100 }`,
 * `overlay { mount: "[data-game-page]" }` and the agent probe. It does not wait for the link (the
 * first status is `connecting`). With a page installed it checks that the manifest says
 * `embedded: true`, which workspace reload and the link's session choice need.
 */
export function startAgent(
  server: ServerStack,
  game: StartedGame,
  options?: AgentOptions & { readonly bare?: false }
): Promise<AgentStack>;
/**
 * Starts an agent without bridge and capture (B1, E2); the server may be undefined.
 */
export function startAgent(
  server: ServerStack | undefined,
  game: StartedGame,
  options: AgentOptions & { readonly bare: true }
): Promise<BareAgentStack>;
/**
 * Creates and starts the agent core over a started game.
 *
 * @param server - The server to link to; undefined only with `bare: true`.
 * @param game - The started game.
 * @param options - Bare, renderer, modules, name, configs, extra plugins.
 * @returns The started agent.
 * @throws {Error} Without a server unless bare, or when the page does not count as embedded.
 */
export async function startAgent(
  server: ServerStack | undefined,
  game: StartedGame,
  options: AgentOptions = {}
): Promise<AgentStack | BareAgentStack> {
  if (server === undefined && options.bare !== true) {
    throw new Error("startAgent needs a server unless options.bare is true");
  }
  const statuses: AgentEvents["bridge:status"][] = [];
  const served = options.png === undefined ? game.app : withRenderer(game.app, options.png);
  const pluginConfigs = agentConfigs(server, served, options);
  const extras = [createAgentProbe(statuses), ...(options.plugins ?? [])];
  const base = { kind: "agent", statuses, game, server, options } as const;

  if (options.bare === true) {
    const app = createBareApp(extras, pluginConfigs);
    app.log.clearSinks();
    await startChecked(app);
    return { ...base, app, stop: () => app.stop() };
  }
  const app = createFullApp(extras, pluginConfigs);
  app.log.clearSinks();
  await startChecked(app);
  return { ...base, app, stop: () => app.stop() };
}

/** What `reloadAgent` updates: a stack, or any object holding the agent and its game. */
export type AgentHolder<Game extends StartedGame = StartedGame> = {
  agent: AgentStack;
  game: Game;
};

/**
 * Plays "the game page reloaded": stops the agent (it says bye) and its game, then starts a new
 * agent with the same server and options on a fresh game. Updates `holder.agent` and
 * `holder.game`.
 *
 * @param holder - The stack (or `{ agent, game }`) to update.
 * @param makeGame - Creates and starts the fresh game, e.g. `createTinyGame`.
 * @returns The new agent.
 * @throws {Error} When the old agent had no server (a bare agent).
 */
export async function reloadAgent<Game extends StartedGame>(
  holder: AgentHolder<Game>,
  makeGame: () => Promise<Game>
): Promise<AgentStack> {
  const old = holder.agent;
  if (old.server === undefined) throw new Error("reloadAgent needs an agent with a server");
  await old.stop().catch(() => undefined);
  await holder.game.stop().catch(() => undefined);
  const game = await makeGame();
  const agent = await startAgent(old.server, game, { ...old.options, bare: false });
  holder.game = game;
  holder.agent = agent;
  return agent;
}
