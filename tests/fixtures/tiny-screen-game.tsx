/* @jsxImportSource @moku-labs/game */
/**
 * @file The tiny screen game: a headless game with a real screen, built from the npm dependency
 * `@moku-labs/game`, so the scene, picker, locate and render tests run on CI. The renderer is
 * inert, so nothing is drawn, but `ui`, `world` and `assets` answer for real: `game.ui`,
 * `game.locate`, `game.projections`, `game.entities`, `game.assets` and `game.tap` work.
 *
 * Flow `main`: `home` (scene `home`, the `play` button) -play-> sub-flow `board`, which rests at
 * `board/awaitIntent` (scene `board`). Its screen is `boardScreen`: a full-bleed background image,
 * the `hudRow` (the `coins` text in the `tiny.coins` text style, the `coinPill` panel on the
 * `ui.hud-pill` nine-slice, the `settings` button) and the `tray` stack, which hosts the items
 * (`tiny.items`) and the count badge (`tiny.badges`, a label). The `settings` button opens the
 * Settings popup at `board/settings/open`: `settingsScreen` with a `settingsBackdrop` that closes
 * it and the `settingsBoard` panel with a `close` button.
 */
import type { Assets } from "@moku-labs/game";
import {
  createApp,
  defineGame,
  effectsPlugin,
  exit,
  label,
  Sprite,
  screen,
  Transform,
  type
} from "@moku-labs/game";
import { createHeadless, fakeClock, memory } from "@moku-labs/game/testing";

/** The display name of the tiny screen game in a manifest. */
export const TINY_SCREEN_NAME = "tiny-screen 0.0.0";

/** One item on the tray: its id and its slot, left to right. */
export type TinyItem = { readonly id: string; readonly slot: number };

/** The player tree of the tiny screen game. */
export type TinyScreenPlayer = { coins: number; items: TinyItem[] };

/** Milliseconds per frame of `frames(n)`. */
const FRAME_MS = 16;

/** The side of an item sprite, in tray units. */
export const ITEM_SIZE = 100;

/** The authoring helpers bound to the tiny screen game's types. */
const {
  defineNode,
  defineFlow,
  defineFeature,
  defineScene,
  defineBundles,
  defineTextStyles,
  defineStyle,
  defineComponent,
  popup,
  projection
} = defineGame<{
  player: TinyScreenPlayer;
  session: Record<string, never>;
  assets: string;
  bundles: "ui" | "board";
  scenes: "home" | "board";
  strings: Record<string, unknown>;
  textStyles: "tiny.coins";
}>();

/** A screen root: the whole viewport, children in a column. */
const fullScreen = defineStyle({ width: "100%", height: "100%", direction: "column" });

/** Behind everything on its screen: the whole viewport, out of the flow. */
const fullBleed = defineStyle({
  position: "absolute",
  left: 0,
  top: 0,
  width: "100%",
  height: "100%",
  reason: "full-bleed background"
});

/** The HUD row along the top. */
const hudRow = defineStyle({
  direction: "row",
  gap: 20,
  padding: 20,
  height: 140,
  align: "center"
});

/** The coin pill: a nine-slice of the `ui` bundle. */
const pillStyle = defineStyle({ width: 160, height: 48, nineSlice: "ui.hud-pill" });

/** The tray the items stand in. */
const trayStyle = defineStyle({ width: 600, height: 600, margin: { left: 240 } });

/** A square button. */
const buttonStyle = defineStyle({ width: 120, height: 120 });

/** The board of the Settings popup. */
const boardStyle = defineStyle({ width: 600, height: 400, margin: { left: 240, top: 500 } });

/** The items: one sprite per item, placed in the tray by its slot. */
const items = projection({
  name: "tiny.items",
  layer: "items",
  from: player => player.items,
  key: item => item.id,
  view: item => [
    Sprite({ texture: "board.cell", width: ITEM_SIZE, height: ITEM_SIZE }),
    Transform({ x: 100 + item.slot * 200, y: 100 })
  ]
});

/** The count badge: a label only, so it has no box of its own. */
const badges = projection({
  name: "tiny.badges",
  layer: "items",
  from: player => [{ id: "count", count: player.items.length }],
  key: badge => badge.id,
  view: badge => label({ text: String(badge.count), style: "tiny.coins", at: { x: 500, y: 500 } })
});

/** The home screen: one Play button. */
const homeScreen = projection({
  name: "home",
  layer: "ui",
  from: () => [{ id: "home" }],
  key: row => row.id,
  view: () => (
    <screen key="homeScreen" style={fullScreen}>
      <button key="play" intent="play" style={buttonStyle} />
    </screen>
  )
});

/** The board screen: background, HUD row and the tray that hosts the items and the badge. */
const hud = projection({
  name: "hud",
  layer: "ui",
  from: player => [{ id: "hud", coins: player.coins }],
  key: row => row.id,
  view: row => (
    <screen key="boardScreen" style={fullScreen}>
      <image key="boardBackground" texture="board.board-tray" fit="cover" style={fullBleed} />
      <row key="hudRow" style={hudRow}>
        <text key="coins" style="tiny.coins" content={String(row.coins)} />
        <panel key="coinPill" style={pillStyle} />
        <button key="settings" intent="openSettings" style={buttonStyle} />
      </row>
      <stack key="tray" hosts={["tiny.items", "tiny.badges"]} style={trayStyle} />
    </screen>
  )
});

/** The Settings popup: a backdrop that closes it and a board with a close button. */
const Settings = defineComponent("Settings", {
  outcomes: { close: type() },
  view: () => (
    <screen key="settingsScreen" style={fullScreen}>
      <button key="settingsBackdrop" intent="close" style={fullBleed} />
      <panel key="settingsBoard" style={boardStyle}>
        <button key="close" intent="close" style={buttonStyle} />
      </panel>
    </screen>
  )
});

/** The rest node of `main`: the home screen. */
const home = defineNode({
  scene: "home",
  outcomes: { play: type() },
  rest: true,
  checkpoint: true
});

/** The rest node of `board`: the board screen. */
const awaitIntent = defineNode({ scene: "board", outcomes: { openSettings: type() }, rest: true });

/** The rest node of `settings`: shows the popup and leaves on its answer. */
const open = defineNode({
  rest: true,
  outcomes: { close: type() },
  run: async ({ fx, out }) => {
    await fx(popup(Settings, {}));
    return out.close();
  }
});

/** The settings sub-flow: the popup over the board. */
const settingsFlow = defineFlow("settings", {
  nodes: { open },
  start: "open",
  outcomes: { close: type() },
  edges: { open: { close: exit("close") } }
});

/** The board sub-flow: the board and its Settings popup. */
const boardFlow = defineFlow("board", {
  nodes: { awaitIntent, settings: settingsFlow },
  start: "awaitIntent",
  edges: { awaitIntent: { openSettings: "settings" }, settings: { close: "awaitIntent" } }
});

/** The top-level flow: `home` -play-> `board`. */
const mainFlow = defineFlow("main", {
  nodes: { home, board: boardFlow },
  start: "home",
  edges: { home: { play: "board" }, board: {} }
});

/** The home scene: the `ui` bundle. */
const homeScene = defineScene("home", { bundle: "ui", layers: {}, projections: [homeScreen] });

/** The board scene: the `board` bundle, the items under the HUD. */
const boardScene = defineScene("board", {
  bundle: "board",
  layers: { items: {}, ui: {} },
  projections: [hud, items, badges]
});

/** Everything the screen brings: scenes, projections, the popup, the text style, the bundles. */
const tinyScreenFeature = defineFeature("tinyScreen", {
  scenes: [homeScene, boardScene],
  projections: [homeScreen, hud, items, badges],
  ui: [Settings],
  textStyles: defineTextStyles({
    "tiny.coins": { font: "ui.font-body", size: 40, fill: 0xff_ff_ff }
  }),
  assets: defineBundles({ ui: { tier: "core" }, board: { tier: "scene" } })
});

/** The asset manifest of the tiny screen game: the two bundles, no font (the io has no pages). */
export const TINY_SCREEN_MANIFEST: Assets.Manifest = {
  version: 1,
  bundles: {
    ui: {
      feature: "tinyScreen",
      tier: "core",
      mb: 0.61,
      files: [{ key: "ui.hud-pill", path: "hud-pill.webp", width: 1024, height: 1024, mb: 0.61 }]
    },
    board: {
      feature: "tinyScreen",
      tier: "scene",
      mb: 1.728,
      files: [
        { key: "board.board-tray", path: "board-tray.webp", width: 640, height: 631, mb: 1.541 },
        { key: "board.cell", path: "cell.webp", width: 224, height: 219, mb: 0.187 }
      ]
    }
  }
};

/** The picture every stand-in decode answers: one pixel, nothing to close. */
const STAND_IN_IMAGE = { width: 1, height: 1, close: () => undefined };

/** The texture every stand-in upload answers. */
// boundary of the test: the inert renderer never reads a texture, so a label stands in for it
const STAND_IN_TEXTURE = { label: "stand-in" } as unknown as ReturnType<
  Assets.AssetsIo["createTexture"]
>;

/** An asset io that loads every bundle for real over stand-in bytes and stand-in textures. */
export const STAND_IN_IO: Assets.AssetsIo = {
  fetch: async () => new Response(new Uint8Array([0])),
  decode: async () => STAND_IN_IMAGE,
  createTexture: () => STAND_IN_TEXTURE,
  sliceTexture: () => STAND_IN_TEXTURE,
  destroyTexture: () => undefined
};

/** The two items a new player starts with. */
const START_ITEMS: TinyItem[] = [
  { id: "a", slot: 0 },
  { id: "b", slot: 1 }
];

/** What a test may pin when it creates the game. */
export type TinyScreenOptions = {
  /** Load the bundles through `STAND_IN_IO`; left out, every bundle counts as loaded at once. */
  readonly io?: boolean;
};

/**
 * The plugin configs of the logic half: `memory()`, a fake clock and the flow.
 *
 * @returns The `model`, `clock` and `flow` configs.
 */
function logicConfigs() {
  return {
    model: {
      playerProvider: memory(),
      initialPlayer: { coins: 5, items: START_ITEMS },
      initialSession: {},
      seed: 1
    },
    clock: { source: fakeClock(1_000_000) },
    flow: { mainFlow, safeNode: "home" }
  };
}

/**
 * Creates the logic half of the tiny screen game (not started): the same flow with the engine's
 * core plugins only, so it has no world, ui, renderer, audio, effects or assets plugin. A route
 * still walks: `game.answer { intent: "play" }` moves it from `home` to `board/awaitIntent`.
 *
 * @returns The app.
 * @example
 * ```ts
 * const app = createTinyLogicGame();
 * await createHeadless(app);
 * ```
 */
export function createTinyLogicGame() {
  return createApp({ pluginConfigs: logicConfigs() });
}

/** The logic half of the tiny screen game, started headless. */
export type TinyHeadless = {
  readonly app: ReturnType<typeof createTinyLogicGame>;
  stop(): Promise<void>;
};

/**
 * Creates the logic half and starts it headless (`createHeadless`): it rests at `home`, and
 * frames move only through `app.time.step`.
 *
 * @returns The app and its stop.
 * @example
 * ```ts
 * const game = await startTinyHeadless();
 * game.app.flow.state().path; // "home"
 * ```
 */
export async function startTinyHeadless(): Promise<TinyHeadless> {
  const app = createTinyLogicGame();
  app.log.clearSinks();
  const headless = await createHeadless(app);
  return { app, stop: () => headless.stop() };
}

/**
 * Creates the tiny screen game (not started): the nine screen plugins and `effects`, the inert
 * renderer, the manifest of `TINY_SCREEN_MANIFEST`, `memory()` and a fake clock.
 *
 * @param options - Whether the bundles load through the stand-in io.
 * @returns The app.
 * @example
 * ```ts
 * const app = createTinyScreenGame({ io: true });
 * await app.start();
 * ```
 */
export function createTinyScreenGame(options: TinyScreenOptions = {}) {
  return createApp({
    plugins: [...screen, effectsPlugin, tinyScreenFeature],
    pluginConfigs: {
      ...logicConfigs(),
      renderer: {},
      assets: {
        manifest: TINY_SCREEN_MANIFEST,
        io: options.io === true ? STAND_IN_IO : undefined
      }
    }
  });
}

/** The tiny screen game app. */
export type TinyScreenApp = ReturnType<typeof createTinyScreenGame>;

/** A started tiny screen game. */
export type TinyScreenGame = {
  readonly app: TinyScreenApp;
  /** Steps `count` frames of 16 ms, draining microtasks and one macrotask after each one. */
  frames(count: number): Promise<void>;
  /** Steps frames until the flow is at `path`, at most 200. */
  until(path: string): Promise<void>;
  stop(): Promise<void>;
};

/** Microtask turns per frame, so the promise chains of one frame settle before the next. */
const SETTLE_MICROTASKS = 40;

/** The most frames `until` steps before it gives up on a path. */
const UNTIL_MAX_FRAMES = 200;

/**
 * Starts the tiny screen game: `start()`, `flow.run()` and six frames, at `home`. The caller
 * stubs `__MOKU_GAME_DEV__` when it runs door commands.
 *
 * @param options - Whether the bundles load through the stand-in io.
 * @returns The started game.
 * @example
 * ```ts
 * const game = await startTinyScreenGame();
 * await run(game.app, commands.tap, { key: "play" });
 * await game.until("board/awaitIntent");
 * ```
 */
export async function startTinyScreenGame(
  options: TinyScreenOptions = {}
): Promise<TinyScreenGame> {
  const app = createTinyScreenGame(options);
  app.log.clearSinks();
  const frames = async (count: number): Promise<void> => {
    for (let frame = 0; frame < count; frame += 1) {
      app.time.step(FRAME_MS);
      for (let tick = 0; tick < SETTLE_MICROTASKS; tick += 1) await Promise.resolve();
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  };
  const until = async (path: string): Promise<void> => {
    for (let step = 0; step < UNTIL_MAX_FRAMES && app.flow.state().path !== path; step += 1)
      await frames(1);
  };
  await app.start();
  app.flow.run().catch(() => undefined);
  await frames(6);
  return { app, frames, until, stop: () => app.stop() };
}
