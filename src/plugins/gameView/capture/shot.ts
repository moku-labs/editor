/**
 * @file gameView plugin — one screenshot: `editor.capture` through panels.run (R9), the PNG
 * through link.files.writeBinary, the toast, the capture card (F2) and its hide timer. Only a
 * user action or an api call starts it; nothing here runs on a timer, an error or a reload.
 */
import { linkPlugin } from "../../link";
import { panelsPlugin } from "../../panels";
import type { Json } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { GAME_COMMANDS, gameReady, NO_GAME_TEXT } from "../commands";
import { reportFailure } from "../report";
import { notify } from "../state";
import type { CaptureFile, GameViewCtx } from "../types";
import {
  capturePath,
  deviceLabel,
  nodeOf,
  type PositionInfo,
  positionOf,
  stamp,
  takenPaths
} from "./naming";

/**
 * How often a held (hovered or focused) capture card checks again whether it may hide.
 */
const CARD_RECHECK_MS = 2000;

/**
 * The value of `editor.capture`.
 */
export type ShotValue = {
  readonly image: string;
  readonly frame: number;
  readonly device: {
    readonly w: number;
    readonly h: number;
    readonly orientation: "portrait" | "landscape";
  };
};

/**
 * True for a JSON object.
 *
 * @param value - A wire value.
 * @returns Whether it is an object (not null, not an array).
 * @example
 * ```ts
 * isObject({ a: 1 }); // true
 * ```
 */
export function isObject(value: Json | undefined): value is { [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads the viewport of a capture value.
 *
 * @param value - The `device` field.
 * @returns w, h and orientation, or undefined.
 * @example
 * ```ts
 * deviceOf({ w: 393, h: 852, orientation: "portrait" })?.w; // 393
 * ```
 */
export function deviceOf(value: Json | undefined): ShotValue["device"] | undefined {
  if (!isObject(value) || typeof value.w !== "number" || typeof value.h !== "number") {
    return undefined;
  }
  const { orientation } = value;
  if (orientation !== "portrait" && orientation !== "landscape") return undefined;
  return { w: value.w, h: value.h, orientation };
}

/**
 * Reads an `editor.capture` value.
 *
 * @param value - The run value.
 * @returns The shot, or undefined for another shape.
 * @example
 * ```ts
 * shotOf({ image: "data:image/png;base64,AA", frame: 3, device: { w: 1, h: 1, orientation: "portrait" } })?.frame; // 3
 * ```
 */
export function shotOf(value: Json): ShotValue | undefined {
  if (!isObject(value) || typeof value.image !== "string" || typeof value.frame !== "number") {
    return undefined;
  }
  const device = deviceOf(value.device);
  return device === undefined ? undefined : { image: value.image, frame: value.frame, device };
}

/**
 * The game.position of now, read once; empty when it cannot be read.
 *
 * @param ctx - Domain context of gameView.
 * @returns Path, flow and node.
 * @example
 * ```ts
 * (await currentPosition(ctx)).flow; // "board"
 * ```
 */
export async function currentPosition(ctx: GameViewCtx): Promise<PositionInfo> {
  try {
    return positionOf(await ctx.require(linkPlugin).read("game.position"));
  } catch {
    return {};
  }
}

/**
 * The paths already in a folder; empty when the folder does not exist yet.
 *
 * @param ctx - Domain context of gameView.
 * @param dir - The folder.
 * @returns The taken paths.
 * @example
 * ```ts
 * await listTaken(ctx, ".moku/captures"); // Set { ".moku/captures/2026-09-24-1012-board.png" }
 * ```
 */
export async function listTaken(ctx: GameViewCtx, dir: string): Promise<ReadonlySet<string>> {
  try {
    return takenPaths(await ctx.require(linkPlugin).files.list(dir));
  } catch {
    return new Set();
  }
}

/**
 * Hides the capture card at once.
 *
 * @param ctx - Domain context of gameView.
 * @returns True when a card was shown.
 * @example
 * ```ts
 * workspace.keys.escape("captureCard", () => hideCard(ctx));
 * ```
 */
export function hideCard(ctx: Pick<GameViewCtx, "state">): boolean {
  const { state } = ctx;
  clearTimeout(state.timers.card);
  delete state.timers.card;
  if (state.card === undefined) return false;

  state.card = undefined;
  state.cardHeld = false;
  notify(state);
  return true;
}

/**
 * Hides the card after a delay unless it is held, then checks every 2 s.
 *
 * @param ctx - Domain context of gameView.
 * @param delayMs - The delay.
 * @example
 * ```ts
 * scheduleCardHide(ctx, 10_000);
 * ```
 */
function scheduleCardHide(ctx: GameViewCtx, delayMs: number): void {
  const { state } = ctx;
  clearTimeout(state.timers.card);
  state.timers.card = setTimeout(() => {
    if (state.cardHeld) scheduleCardHide(ctx, CARD_RECHECK_MS);
    else hideCard(ctx);
  }, delayMs);
}

/**
 * Shows the capture card of a saved shot and arms its hide timer.
 *
 * @param ctx - Domain context of gameView.
 * @param card - The saved capture.
 * @example
 * ```ts
 * showCard(ctx, { path: ".moku/captures/2026-09-24-1012-board.png", frame: 1841, device: "iPhone 15 portrait", image });
 * ```
 */
export function showCard(ctx: GameViewCtx, card: CaptureFile): void {
  ctx.state.card = card;
  ctx.state.cardHeld = false;
  scheduleCardHide(ctx, ctx.config.captureCardMs);
  notify(ctx.state);
}

/**
 * Takes one screenshot through panels.run and saves it under `capturesDir`.
 *
 * @param ctx - Domain context of gameView.
 * @returns The saved capture, undefined without a game or on a failure (toasted).
 * @example
 * ```ts
 * (await takeScreenshot(ctx))?.path; // ".moku/captures/2026-09-24-1012-board.png"
 * ```
 */
export async function takeScreenshot(ctx: GameViewCtx): Promise<CaptureFile | undefined> {
  const link = ctx.require(linkPlugin);
  const workspace = ctx.require(workspacePlugin);
  if (!gameReady(link, GAME_COMMANDS.capture)) {
    workspace.toast(NO_GAME_TEXT);
    return undefined;
  }

  try {
    const position = await currentPosition(ctx);
    const ran = await ctx.require(panelsPlugin).run(GAME_COMMANDS.capture);
    const shot = shotOf(ran.value);
    if (shot === undefined) {
      throw new Error(
        "[moku-editor] editor.capture returned no image.\n  Update the game's capturePlugin."
      );
    }
    const { capturesDir } = ctx.config;
    const taken = await listTaken(ctx, capturesDir);
    const path = capturePath(capturesDir, stamp(new Date()), nodeOf(position), taken);
    await link.files.writeBinary(path, shot.image);

    const preset = workspace.device().preset;
    const card: CaptureFile = {
      path,
      frame: shot.frame,
      device: deviceLabel(preset.name, shot.device.orientation),
      image: shot.image
    };
    showCard(ctx, card);
    workspace.toast("✓ Screenshot saved", path);
    return card;
  } catch (error) {
    reportFailure(ctx, "Screenshot failed", "gameView: capture failed", error);
    return undefined;
  }
}
