/**
 * Complex tier — the Game workspace: device stage, element picker, Element and Device tabs,
 * screenshots, series and the contact sheet. Declares no events; emits the global
 * `workspace:reveal`, `workspace:new-note`, `workspace:open-file`; hooks `link:status`,
 * `workspace:changed`, `workspace:open-sheet`, `workspace:inspect`.
 *
 * @see README.md
 */
import { createToolsPlugin } from "../../config";
import { linkPlugin } from "../link";
import { panelsPlugin } from "../panels";
import { workspacePlugin } from "../workspace";
import { createGameViewApi } from "./api";
import { createHandlers } from "./handlers";
import { initGameView, startGameView, stopGameView } from "./lifecycle";
import { createGameViewState } from "./state";
import type { GameViewConfig } from "./types";

const defaultConfig: GameViewConfig = {
  capturesDir: ".moku/captures",
  notesDir: ".moku/notes",
  manifestPaths: ["manifest.json", "public/manifest.json", "web/manifest.json"],
  captureCardMs: 10_000,
  seriesDurationsMs: [1000, 2000, 5000, 10_000, 20_000],
  seriesIntervalsMs: [16, 50, 100, 250, 500, 1000],
  seriesWarnShots: 200,
  sourceSearch: { maxFiles: 400, skip: ["node_modules", "dist", ".git", ".moku"] }
};

/**
 * The Game workspace plugin.
 *
 * @example
 * ```ts
 * const shot = await app.gameView.capture(); // { path: ".moku/captures/2026-09-24-1012-board.png", … }
 * ```
 */
export const gameViewPlugin = createToolsPlugin("gameView", {
  depends: [linkPlugin, workspacePlugin, panelsPlugin],
  config: defaultConfig,
  createState: createGameViewState,
  api: createGameViewApi,
  hooks: createHandlers,
  onInit: initGameView,
  // @no-resource-check — onStart may open the scene watches; onStop drops them and the disposers
  onStart: startGameView,
  onStop: stopGameView
});
