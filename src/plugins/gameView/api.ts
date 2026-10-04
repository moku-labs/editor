/**
 * @file gameView plugin — api factory: binds the scene, element, capture, series and sheet
 * functions to the plugin context. The contract and the examples live on `GameViewApi` in
 * types.ts.
 */

import { recordSeries, stopRecording } from "./capture/series";
import { openSheet } from "./capture/sheet";
import { takeScreenshot } from "./capture/shot";
import {
  highlightElement,
  inspectElement,
  selectElement,
  selectedElement,
  setPicker
} from "./element/select";
import { readManifest } from "./scene/manifest";
import { locateElement, readScene } from "./scene/read";
import type { GameViewApi, GameViewCtx } from "./types";

/**
 * Creates the gameView api.
 *
 * @param ctx - Domain context of gameView.
 * @returns The GameViewApi (`app.gameView`).
 */
export function createGameViewApi(ctx: GameViewCtx): GameViewApi {
  return {
    pick: setPicker.bind(undefined, ctx),
    selected: selectedElement.bind(undefined, ctx),
    select: selectElement.bind(undefined, ctx),
    inspect: inspectElement.bind(undefined, ctx),
    scene: readScene.bind(undefined, ctx),
    locate: locateElement.bind(undefined, ctx),
    highlight: highlightElement.bind(undefined, ctx),
    manifest: readManifest.bind(undefined, ctx),
    capture: takeScreenshot.bind(undefined, ctx),
    series: recordSeries.bind(undefined, ctx),
    stopSeries: stopRecording.bind(undefined, ctx),
    openSheet: openSheet.bind(undefined, ctx)
  };
}
