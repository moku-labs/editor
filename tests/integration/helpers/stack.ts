/**
 * @file The one import of every root integration test (plan §2): the tiny game, the project
 * roots, the server, agent and tools stacks over the real wire, the page, the waits and the
 * bounded shutdown. "Stack" in the scenarios is `startStack()`: a tiny project, the server, the
 * page, an agent on a tiny game and the tools app, all live.
 */
import { vi } from "vitest";
import { type AgentOptions, type AgentStack, type BareAgentStack, startAgent } from "./agent-stack";
import { closePage, installPage, type Page } from "./page";
import { createProject, removeTemps } from "./project";
import {
  type ConsumerServe,
  type ServerConfigs,
  type ServerStack,
  startServer
} from "./server-stack";
import { createTinyGame, type StartedGame, type TinyGame } from "./tiny-game";
import { bootTools, type ToolsOptions, type ToolsStack } from "./tools-stack";
import { until } from "./wait";

export {
  type AgentApp,
  type AgentConfigs,
  type AgentHolder,
  type AgentOptions,
  type AgentStack,
  type BareAgentApp,
  type BareAgentStack,
  reloadAgent,
  startAgent
} from "./agent-stack";
export { closePage, currentPage, installPage, type Page } from "./page";
export {
  createPageDir,
  createProject,
  FIRST_NOTE,
  removeTemps,
  STYLES_FIXTURE,
  TINY_MANIFEST
} from "./project";
export {
  type ConsumerServe,
  type ServerApp,
  type ServerConfigs,
  type ServerStack,
  startServer,
  startServerOnPort
} from "./server-stack";
export { type ConnKind, paramsOf, type Tap, type TapEntry, type TapSocket } from "./tap";
export {
  createTinyGame,
  PNG_1X1,
  type StartedGame,
  TINY_NAME,
  type TinyApp,
  type TinyGame,
  type TinyPlayer,
  tinyModule,
  withRenderer
} from "./tiny-game";
export {
  bootTools,
  type ToolsApp,
  type ToolsConfigs,
  type ToolsEvent,
  type ToolsOptions,
  type ToolsStack
} from "./tools-stack";
export {
  type Logged,
  logErrors,
  settle,
  trackUnhandled,
  type UnhandledTracker,
  until
} from "./wait";

/** Options of `startStack`: what each part of the stack takes. */
export type StackOptions = {
  /** Extra server pluginConfigs (e.g. `{ hub: { callTimeoutMs: 300 } }`). */
  readonly server?: ServerConfigs;
  /** The game's own routes and fetch. */
  readonly serve?: ConsumerServe;
  /** Agent options (e.g. `{ png: PNG_1X1, configs: { bridge: { callTimeoutMs: 300 } } }`). */
  readonly agent?: AgentOptions & { readonly bare?: false };
  /** Tools options (extra plugins, configs, boot change). */
  readonly tools?: ToolsOptions;
};

/** The whole stack, live. `agent` and `game` change on `reloadAgent(stack, createTinyGame)`. */
export type Stack = {
  readonly kind: "stack";
  /** The tiny project root. */
  readonly root: string;
  readonly server: ServerStack;
  readonly page: Page;
  game: TinyGame;
  agent: AgentStack;
  readonly tools: ToolsStack;
};

/**
 * Starts the whole stack: `__MOKU_GAME_DEV__ = true`, `createProject("tiny")`, `startServer`,
 * `installPage`, `startAgent(createTinyGame())`, `bootTools`, then waits until the link is `live`
 * with a manifest and holds the first project state (the index opens on the server's start, not
 * awaited).
 *
 * @param options - What each part takes.
 * @returns The live stack.
 */
export async function startStack(options: StackOptions = {}): Promise<Stack> {
  vi.stubGlobal("__MOKU_GAME_DEV__", true);
  const root = await createProject("tiny");
  const server = await startServer(root, options.server, options.serve);
  const page = installPage(server.origin, server.app.hub.path());
  const game = await createTinyGame();
  const agent = await startAgent(server, game, options.agent);
  const tools = await bootTools(server, options.tools);
  const { link } = tools.app;
  await until(
    () =>
      link.status().kind === "live" &&
      link.manifest() !== undefined &&
      link.project() !== undefined,
    "a live link with a manifest and a project state"
  );
  return { kind: "stack", root, server, page, game, agent, tools };
}

/** Anything `shutdown` stops. Undefined entries are skipped (a setup that failed half way). */
export type Stoppable =
  | Stack
  | ToolsStack
  | AgentStack
  | BareAgentStack
  | ServerStack
  | StartedGame;

/** How long one app stop may take before shutdown moves on. */
const STOP_BOUND_MS = 2000;

/**
 * Stops one part, never throwing and never waiting longer than the bound.
 *
 * @param part - Something with a stop.
 * @param part.stop - Its stop.
 * @returns Resolves when stopped or bounded.
 */
async function stopBounded(part: { stop(): Promise<void> }): Promise<void> {
  await Promise.race([part.stop().catch(() => undefined), Bun.sleep(STOP_BOUND_MS)]);
}

/** The parts of the stacks `shutdown` got, by kind, in the given order. */
type Parts = {
  readonly tools: ToolsStack[];
  readonly agents: (AgentStack | BareAgentStack)[];
  readonly games: StartedGame[];
  readonly servers: ServerStack[];
};

/**
 * Splits the stacks into their parts, a whole stack into its tools, agent, game and server.
 *
 * @param stacks - The stacks.
 * @returns The parts by kind, in the given order.
 */
function partsOf(stacks: readonly (Stoppable | undefined)[]): Parts {
  const parts: Parts = { tools: [], agents: [], games: [], servers: [] };
  for (const stack of stacks) {
    switch (stack?.kind) {
      case undefined: {
        break;
      }
      case "stack": {
        parts.tools.push(stack.tools);
        parts.agents.push(stack.agent);
        parts.games.push(stack.game);
        parts.servers.push(stack.server);
        break;
      }
      case "tools": {
        parts.tools.push(stack);
        break;
      }
      case "agent": {
        parts.agents.push(stack);
        break;
      }
      case "game": {
        parts.games.push(stack);
        break;
      }
      case "server": {
        parts.servers.push(stack);
        break;
      }
    }
  }
  return parts;
}

/**
 * Stops everything, bounded: tools apps, then agents, then games, then server apps with the
 * bounded `server.stop(true)`; then closes the page, unstubs every global and removes every temp
 * folder of this test file. Errors of a stop are swallowed: an app may already be stopped.
 *
 * @param stacks - Stacks and parts to stop; undefined entries are skipped.
 * @returns Resolves when everything is down.
 */
export async function shutdown(...stacks: readonly (Stoppable | undefined)[]): Promise<void> {
  const parts = partsOf(stacks);
  for (const tools of parts.tools) await stopBounded(tools);
  for (const agent of parts.agents) await stopBounded(agent);
  for (const game of parts.games) await stopBounded(game);
  for (const server of parts.servers) await stopBounded(server);
  await closePage();
  vi.unstubAllGlobals();
  await removeTemps();
}
