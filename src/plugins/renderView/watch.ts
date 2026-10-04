/**
 * @file renderView plugin — the data path (R6): the tracker watches game.render and game.assets
 * for the session, and game.effects while the manifest lists it as available; the scene watches game.ui, game.entities and game.projections only while
 * Render is shown and build one scene per animation frame; the calibration reads the page rect
 * of one keyed element once per session and device (`game.locate` on game 0.4, `game.rect` on game
 * 0.1, nothing when the manifest lists neither); the catalogue reads the asset manifest. No timer
 * reads a frame source.
 */
import { linkPlugin } from "../link";
import type { TextureCatalogue } from "../panels/shared/scene";
import {
  buildScene,
  calibrationFrom,
  calibrationTarget,
  parseTextureManifest,
  rectSourceOf
} from "../panels/shared/scene";
import { rectOf } from "../panels/shared/scene/wire";
import type { Json, LinkStatus, Manifest } from "../registry/protocol";
import { applyPendingReveal, setTexturePalette } from "./actions";
import { releasesOf, updateTextureUse } from "./derive";
import { asAssetsUsage, asEffectsStats, asRenderStats } from "./guards";
import { drawBox } from "./overlay";
import { notify } from "./state";
import type { RenderViewCtx, RenderViewState } from "./types";

/**
 * A scene source and the `state.sources` key it fills.
 */
type SceneSource = readonly [key: keyof RenderViewState["sources"], id: string];

/**
 * The three scene sources, in watch order.
 */
const SCENE_SOURCES: readonly SceneSource[] = [
  ["ui", "game.ui"],
  ["entities", "game.entities"],
  ["projections", "game.projections"]
];

/**
 * The effects source of game 0.0.3; an older game's manifest does not list it.
 */
const EFFECTS_ID = "game.effects";

/**
 * The states with a scene build queued for the next animation frame.
 */
const queued = new WeakSet<RenderViewState>();

/**
 * The frame a link status reports, or a fallback.
 *
 * @param status - The link status.
 * @param fallback - Used while connecting or empty.
 * @returns The frame.
 * @example
 * ```ts
 * frameOf({ kind: "silent", since: 1, lastFrame: 1840 }, 0); // 1840
 * ```
 */
export function frameOf(status: LinkStatus, fallback: number): number {
  if (status.kind === "live" || status.kind === "paused") return status.frame;
  if (status.kind === "silent" || status.kind === "lost") return status.lastFrame;
  return fallback;
}

/**
 * The text of a thrown value.
 *
 * @param error - Anything thrown.
 * @returns Its message.
 * @example
 * ```ts
 * messageOf(new Error("[moku-editor] timeout")); // "[moku-editor] timeout"
 * ```
 */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records a value of the wrong shape: sets `error`, warns once per value.
 *
 * @param ctx - Domain context of renderView.
 * @param id - The source id.
 * @param detail - Where it was wrong, if known.
 */
function shapeError(ctx: RenderViewCtx, id: string, detail = ""): void {
  ctx.state.error = `${id}: unexpected shape${detail}`;
  ctx.log.warn("renderView: unexpected source shape", { id });
  notify(ctx.state);
}

/**
 * Clears the shape error of a source after a good value.
 *
 * @param state - renderView state.
 * @param id - The source id.
 */
function clearError(state: RenderViewState, id: string): void {
  if (state.error?.startsWith(`${id}:`)) state.error = undefined;
}

/**
 * The frame of the current link status, the last game.render frame as the fallback.
 *
 * @param ctx - Domain context of renderView.
 * @returns The frame.
 */
function currentFrame(ctx: RenderViewCtx): number {
  return frameOf(ctx.require(linkPlugin).status(), ctx.state.lastFrame ?? 0);
}

/**
 * One game.render value: stats, frame, one FPS sample (trimmed to fpsSamples) and the page heap
 * link holds from the last heartbeat.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The value.
 */
function onRender(ctx: RenderViewCtx, value: Json): void {
  const { state, config } = ctx;
  const stats = asRenderStats(value);
  if (stats === undefined) {
    shapeError(ctx, "game.render");
    return;
  }

  const frame = currentFrame(ctx);
  const heap = ctx.require(linkPlugin).heap();
  clearError(state, "game.render");
  state.render = stats;
  state.lastFrame = frame;
  state.firstFrame ??= frame;
  state.fps = [...state.fps, stats.fps].slice(-config.fpsSamples);
  state.heap = heap === undefined ? undefined : { usedMb: heap.usedMb, limitMb: heap.limitMb };
  notify(state);
}

/**
 * One game.assets value: the bundles gone since the previous value enter the release log.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The value.
 */
function onAssets(ctx: RenderViewCtx, value: Json): void {
  const { state, config } = ctx;
  const usage = asAssetsUsage(value);
  if (usage === undefined) {
    shapeError(ctx, "game.assets");
    return;
  }

  const gone = releasesOf(state.loaded, usage, state.lastFrame ?? currentFrame(ctx));
  clearError(state, "game.assets");
  state.releases = [...gone, ...state.releases].slice(0, config.releaseLogMax);
  state.loaded = new Map(
    usage.bundles.map(bundle => [bundle.name, { tier: bundle.tier, mb: bundle.mb }])
  );
  state.assets = usage;
  notify(state);
}

/**
 * One game.effects value: the last good value is kept, a bad shape warns and is dropped.
 *
 * @param ctx - Domain context of renderView.
 * @param value - The value.
 */
function onEffects(ctx: RenderViewCtx, value: Json): void {
  const effects = asEffectsStats(value);
  if (effects === undefined) {
    shapeError(ctx, EFFECTS_ID);
    return;
  }

  clearError(ctx.state, EFFECTS_ID);
  ctx.state.effects = effects;
  notify(ctx.state);
}

/**
 * Stops the game.effects watch and forgets its value. Teardown-safe: it needs the state only.
 *
 * @param state - renderView state.
 */
export function stopEffects(state: RenderViewState): void {
  const stop = state.effectsWatch;
  state.effectsWatch = undefined;
  state.effects = undefined;
  stop?.();
}

/**
 * Follows the manifest: one game.effects watch while it lists the source as available (game
 * 0.0.3); a manifest without it (an older game) or with `available: false` (no effects plugin,
 * "not installed") stops the watch and clears the value; an undefined manifest (session lost)
 * keeps the watch, which link re-sends on attach. Both happen at once: link sends a watch added
 * inside the listener once per attach, and does not re-send a source the new manifest lacks.
 *
 * @param ctx - Domain context of renderView.
 * @param manifest - The manifest of the session, undefined while none is attached.
 */
export function syncEffects(ctx: RenderViewCtx, manifest: Manifest | undefined): void {
  if (manifest === undefined) return;

  const { state } = ctx;
  const effects = manifest.sources.find(source => source.id === EFFECTS_ID);
  const installed = effects?.available !== false;
  const changed = state.effectsInstalled !== installed;
  state.effectsInstalled = installed;

  if (effects !== undefined && installed) {
    state.effectsWatch ??= ctx
      .require(linkPlugin)
      .watch(EFFECTS_ID, undefined, value => onEffects(ctx, value));
    if (changed) notify(state);
    return;
  }
  stopEffects(state);
  notify(state);
}

/**
 * Starts the session watches of game.render and game.assets and the manifest listener that
 * starts game.effects when the manifest lists it (once).
 *
 * @param ctx - Domain context of renderView.
 */
export function startTracker(ctx: RenderViewCtx): void {
  if (ctx.state.tracker.length > 0) return;

  const link = ctx.require(linkPlugin);
  ctx.state.tracker.push(
    link.watch("game.render", undefined, value => onRender(ctx, value)),
    link.watch("game.assets", undefined, value => onAssets(ctx, value)),
    link.onManifest(manifest => syncEffects(ctx, manifest))
  );
}

/**
 * Builds the scene from the stored sources now: texture use, the roots open on the first scene
 * of a session, a waiting reveal, the box follows its element. A shape error keeps the last scene.
 *
 * @param ctx - Domain context of renderView.
 */
function buildNow(ctx: RenderViewCtx): void {
  const { state } = ctx;
  const { ui, entities, projections } = state.sources;
  if (ui === undefined || entities === undefined || projections === undefined) return;

  const built = buildScene({
    ui,
    entities,
    projections,
    frame: currentFrame(ctx),
    calibration: state.calibration
  });
  if ("error" in built) {
    shapeError(ctx, built.source, ` at ${built.path}`);
    return;
  }

  if (state.scene === undefined) for (const root of built.roots) state.tree.open.add(root);
  state.scene = built;
  updateTextureUse(state, built);
  applyPendingReveal(ctx);
  drawBox(ctx);
  notify(state);
}

/**
 * Runs a queued build: dropped once the scene watches stopped.
 *
 * @param ctx - Domain context of renderView.
 */
function runBuild(ctx: RenderViewCtx): void {
  queued.delete(ctx.state);
  if (ctx.state.watching.length > 0) buildNow(ctx);
}

/** One frame at 60 fps: the timeout that stands in for requestAnimationFrame where it does not exist. */
const FALLBACK_FRAME_MS = 16;

/**
 * Queues one scene build on the next animation frame; a burst of values builds once. A build
 * queued before the scene watches stopped is dropped.
 *
 * @param ctx - Domain context of renderView.
 */
function scheduleBuild(ctx: RenderViewCtx): void {
  const { state } = ctx;
  if (queued.has(state)) return;

  queued.add(state);
  if (typeof globalThis.requestAnimationFrame === "function") {
    globalThis.requestAnimationFrame(() => runBuild(ctx));
  } else {
    setTimeout(() => runBuild(ctx), FALLBACK_FRAME_MS);
  }
}

/**
 * Starts the scene watches while Render is shown (once): every value is stored, game.ui asks the
 * calibration once, and a build is queued.
 *
 * @param ctx - Domain context of renderView.
 */
export function startScene(ctx: RenderViewCtx): void {
  const { state } = ctx;
  if (state.watching.length > 0) return;

  const link = ctx.require(linkPlugin);
  for (const [key, id] of SCENE_SOURCES) {
    const stop = link.watch(id, undefined, value => {
      // A late value after stopScene is dropped.
      if (state.watching.length === 0) return;
      state.sources[key] = value;
      if (key === "ui" && !state.calibrationAsked) void calibrate(ctx);
      scheduleBuild(ctx);
    });
    state.watching.push(stop);
  }
}

/**
 * Stops the scene watches and forgets their values (Render hidden).
 *
 * @param ctx - Domain context of renderView.
 */
export function stopScene(ctx: RenderViewCtx): void {
  const { state } = ctx;
  const stops = state.watching;
  state.watching = [];
  state.sources = {};
  for (const stop of stops) stop();
}

/**
 * Calibrates from the stored game.ui: the first keyed element's drawn rect and its page rect (one
 * read of `game.locate`, else `game.rect`). A manifest that lists neither reports no element
 * rects: nothing is read, nothing is warned and the calibration stays undefined. Marks the
 * calibration asked first, so a burst reads once; queues a rebuild while the scene is watched.
 * Never rejects.
 *
 * @param ctx - Domain context of renderView.
 * @returns Resolves when the calibration is known.
 */
export async function calibrate(ctx: RenderViewCtx): Promise<void> {
  const { state } = ctx;
  const { ui } = state.sources;
  if (ui === undefined) return;

  state.calibrationAsked = true;
  const link = ctx.require(linkPlugin);
  const target = calibrationTarget(ui);
  const source = rectSourceOf(link.manifest());
  if (target === undefined || source === undefined) {
    state.calibration = undefined;
    notify(state);
    return;
  }

  try {
    const page = rectOf(await link.read(source, { key: target.key }));
    state.calibration = page === undefined ? undefined : calibrationFrom(page, target.drawn);
  } catch (error) {
    state.calibration = undefined;
    ctx.log.warn("renderView: calibration failed", { key: target.key, message: messageOf(error) });
  }
  if (state.watching.length > 0) scheduleBuild(ctx);
  notify(state);
}

/**
 * Forgets the calibration of the old device; calibrates again while the scene is watched.
 *
 * @param ctx - Domain context of renderView.
 */
export function recalibrate(ctx: RenderViewCtx): void {
  ctx.state.calibrationAsked = false;
  if (ctx.state.watching.length > 0) void calibrate(ctx);
}

/**
 * Reads one manifest candidate; a missing or unreadable file is undefined.
 *
 * @param ctx - Domain context of renderView.
 * @param path - A candidate path.
 * @returns The catalogue, or undefined.
 */
async function readCandidate(
  ctx: RenderViewCtx,
  path: string
): Promise<TextureCatalogue | undefined> {
  try {
    const file = await ctx.require(linkPlugin).files.read(path);
    return parseTextureManifest(file.text, path);
  } catch {
    return undefined;
  }
}

/**
 * The game's texture catalogue: the first `manifestPaths` entry that holds a version-1 asset
 * manifest, read through link.files.
 *
 * @param ctx - Domain context of renderView.
 * @returns The catalogue, or null when no path holds one.
 */
export async function readCatalogue(ctx: RenderViewCtx): Promise<TextureCatalogue | null> {
  for (const path of ctx.config.manifestPaths) {
    const catalogue = await readCandidate(ctx, path);
    if (catalogue !== undefined) return catalogue;
  }
  // eslint-disable-next-line unicorn/no-null -- null is the spec's "looked, not found" marker
  return null;
}

/**
 * Re-reads the catalogue and the calibration (the Refresh action, once per session when Render
 * is shown, a session change). Skipped while the link is not live or paused. Never rejects.
 *
 * @param ctx - Domain context of renderView.
 * @returns Resolves when both reads settled.
 */
export async function refreshRenderView(ctx: RenderViewCtx): Promise<void> {
  const { kind } = ctx.require(linkPlugin).status();
  if (kind !== "live" && kind !== "paused") return;

  const { state } = ctx;
  state.catalogue = await readCatalogue(ctx);
  setTexturePalette(ctx);
  notify(state);
  state.calibrationAsked = false;
  await calibrate(ctx);
}
