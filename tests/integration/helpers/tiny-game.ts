/**
 * @file The tiny game of the root integration wave (plan §2.1): built from the npm dependency
 * `@moku-labs/game`, so it runs on CI. Flow `main` rests at `home`; the intent `play` walks the
 * sub-flow `visit` (`enter` adds 5 coins and 1 visit, `leave`) and comes back. Its `.dev` module
 * `tinyModule` adds the sources and commands the scenarios need. The game has no frame source:
 * frames move only through `frames(n)`, like every headless game.
 */
import type { Log } from "@moku-labs/common/browser";
import { createApp, defineGame, exit, type } from "@moku-labs/game";
import { defineCommand } from "@moku-labs/game/control";
import { defineSource } from "@moku-labs/game/inspect";
import type { HeadlessApp } from "@moku-labs/game/testing";
import { createHeadless, fakeClock, memory } from "@moku-labs/game/testing";
import type { Registry } from "../../../src/agent";
import { withoutPage } from "./page";
import { settle } from "./wait";

/** The display name the agent passes as `registry.name`. */
export const TINY_NAME = "tiny-game 0.0.0";

/** A real 1×1 PNG as a data URL: `files.writeBinary` decodes it, `readBinary` returns it. */
export const PNG_1X1 =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/** The player tree of the tiny game. */
export type TinyPlayer = { coins: number; visits: number };

/** The session tree of the tiny game: empty. */
export type TinySession = Record<string, never>;

/** Where the fake clock starts. */
const START_MOMENT = 1_000_000;

/** Milliseconds per frame of `frames(n)`. */
const FRAME_MS = 16;

/** The authoring helpers bound to the tiny game's types. */
const { defineNode, defineFlow } = defineGame<{
  player: TinyPlayer;
  session: TinySession;
  assets: string;
  strings: Record<string, unknown>;
}>();

/** The rest node and checkpoint of `main`. */
const home = defineNode({ outcomes: { play: type() }, rest: true, checkpoint: true });

/** First node of `visit`: pays 5 coins and counts the visit. */
const enter = defineNode({
  outcomes: { done: type() },
  run: ({ player, out }) => {
    player.coins += 5;
    player.visits += 1;
    return out.done();
  }
});

/** Last node of `visit`. */
const leave = defineNode({ outcomes: { done: type() }, run: ({ out }) => out.done() });

/** The sub-flow `visit`, so flowView `flows.expand/enter/up` has something to open. */
const visitFlow = defineFlow("visit", {
  nodes: { enter, leave },
  start: "enter",
  outcomes: { done: type() },
  edges: { enter: { done: "leave" }, leave: { done: exit("done") } }
});

/** The top-level flow: `home` -play-> `visit` -done-> `home`. */
const mainFlow = defineFlow("main", {
  nodes: { home, visit: visitFlow },
  start: "home",
  edges: { home: { play: "visit" }, visit: { done: "home" } }
});

/**
 * Creates the tiny game app (not started) with the engine's own doubles: `memory()` and
 * `fakeClock`.
 *
 * @param clock - The fake clock the app reads.
 * @returns The app.
 */
function createTinyApp(clock: ReturnType<typeof fakeClock>) {
  return createApp({
    pluginConfigs: {
      model: {
        playerProvider: memory(),
        initialPlayer: { coins: 0, visits: 0 },
        initialSession: {},
        seed: 42
      },
      clock: { source: clock },
      flow: { mainFlow, safeNode: "home" }
    }
  });
}

/** The tiny game app: the full engine app type, so a test reads `app.model.store`. */
export type TinyApp = ReturnType<typeof createTinyApp>;

/** Any started game the agent can serve. */
export type StartedGame = {
  readonly kind: "game";
  readonly app: Registry.GameLike;
  stop(): Promise<void>;
};

/** The started tiny game and the seams a test holds on to. */
export type TinyGame = StartedGame & {
  readonly app: TinyApp;
  readonly clock: ReturnType<typeof fakeClock>;
  /** Steps `count` frames of 16 ms, settling the event loop after each one. */
  frames(count: number): Promise<void>;
};

/** What a tiny game counts for its module: the `tiny.count` value and the warns so far. */
type Counters = { count: number; warns: number };

/** Counters per game, keyed by the game's flow api (the same object through a renderer Proxy). */
const counters = new WeakMap<object, Counters>();

/**
 * The counters of one game, created on first use.
 *
 * @param app - The game app (or its renderer Proxy).
 * @returns The live counters.
 */
function countersOf(app: HeadlessApp): Counters {
  const known = counters.get(app.flow);
  if (known !== undefined) return known;
  const fresh: Counters = { count: 0, warns: 0 };
  counters.set(app.flow, fresh);
  return fresh;
}

/**
 * The value `tiny.fn` reads: a function, which is not JSON (-32006 on the wire).
 *
 * @returns 1.
 */
const notJson = (): number => 1;

/** What `tiny.warn` needs of an app: the headless app plus the game's log. */
type LoggingApp = HeadlessApp & { readonly log: Log.LogApi };

/**
 * The tiny game's `.dev` module: `tiny.count` (frame source), `tiny.map` (a Map), `tiny.fn` (a
 * function, not JSON); `tiny.warn` (cheat, logs `tiny:warned`), `tiny.fail` (throws "boom"),
 * `tiny.hang` (never answers), `tiny.bump` (adds 1 to `tiny.count`).
 */
export const tinyModule: Registry.DevModule = {
  sources: [
    defineSource({
      id: "tiny.count",
      title: "Count",
      input: {},
      changes: "frame",
      read: (app: HeadlessApp) => countersOf(app).count
    }),
    defineSource({
      id: "tiny.map",
      title: "Map",
      input: {},
      changes: "commit",
      read: () => new Map([["a", 1]])
    }),
    defineSource({
      id: "tiny.fn",
      title: "Function",
      input: {},
      changes: "commit",
      read: () => notJson
    })
  ],
  commands: [
    defineCommand({
      id: "tiny.warn",
      title: "Warn",
      input: {},
      effect: "cheat",
      run: (app: LoggingApp) => {
        const counted = countersOf(app);
        counted.warns += 1;
        app.log.warn("tiny:warned", { n: counted.warns });
        return counted.warns;
      }
    }),
    defineCommand({
      id: "tiny.fail",
      title: "Fail",
      input: {},
      effect: "cosmetic",
      run: () => {
        throw new Error("boom");
      }
    }),
    defineCommand({
      id: "tiny.hang",
      title: "Hang",
      input: {},
      effect: "cosmetic",
      run: () => new Promise<never>(() => undefined)
    }),
    defineCommand({
      id: "tiny.bump",
      title: "Bump",
      input: {},
      effect: "cosmetic",
      run: (app: HeadlessApp) => {
        const counted = countersOf(app);
        counted.count += 1;
        return counted.count;
      }
    })
  ]
};

/**
 * Hands the `game.capture` door a renderer that answers `png` (the Proxy seam of the capture
 * plugin test). Every other key reads the real app.
 *
 * @param app - The game app.
 * @param png - The data URL the renderer answers.
 * @returns The app behind a Proxy with a `renderer`.
 */
export function withRenderer<App extends object>(app: App, png: string): App {
  const renderer = { capture: async (): Promise<string> => png };
  return new Proxy(app, {
    get: (target, key) => (key === "renderer" ? renderer : Reflect.get(target, key))
  });
}

/**
 * Creates the tiny game and starts it headless; it rests at `home` on frame 1. The page is hidden
 * while it starts (`withoutPage`), so no real frame loop runs: frames move only through
 * `frames(n)`. The caller stubs `__MOKU_GAME_DEV__ = true` (startStack does).
 *
 * @returns The started game.
 */
export async function createTinyGame(): Promise<TinyGame> {
  const clock = fakeClock(START_MOMENT);
  const app = createTinyApp(clock);
  app.log.clearSinks();

  const headless = await withoutPage(() => createHeadless(app));

  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      app.time.step(FRAME_MS);
      await settle();
    }
  };
  // Frame numbers are > 0 from the start, so a `live` status carries a real frame.
  await frames(1);

  return { kind: "game", app, clock, frames, stop: () => headless.stop() };
}
