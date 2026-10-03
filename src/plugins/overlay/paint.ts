/**
 * @file overlay plugin — the pure view model (viewOf, renderChips, linkLabel, toRenderNumbers)
 * and paint, which renders the card into the shadow root.
 */
import { Fragment, h, render } from "preact";
import type { Json, LinkStatus } from "../registry/protocol";
import { runCheat } from "./cheats";
import { overlayCss } from "./styles";
import type {
  CheatResult,
  CheatView,
  Config,
  OverlayCtx,
  OverlayState,
  OverlayView,
  RenderChip,
  RenderNumbers
} from "./types";
import { ERROR_MS, OK_MS } from "./types";
import { OverlayCard } from "./view/OverlayCard";

/**
 * The title of the chip shown when game.render cannot be read.
 */
const UNAVAILABLE_TITLE = "game.render is not available in this build";

/**
 * Renders the card (and, without an adopted sheet, its `<style>`) into the shadow root. Does
 * nothing before mount. Clicks run the cheat through runCheat.
 *
 * @param octx - Domain context.
 * @example
 * ```ts
 * octx.state.render = { fps: 60, frameMs: 4.1, textureMb: 31.1 };
 * paint(octx); // the chips read "fps 60", "4.1 ms", "textures 31.1 MB"
 * ```
 */
export function paint(octx: OverlayCtx): void {
  const { root } = octx.state;
  if (root === undefined) return;

  /**
   * Runs the clicked cheat; runCheat records the result and never rejects.
   *
   * @param id - The cheat id.
   * @returns Settles when the result is recorded.
   * @example
   * ```ts
   * await onCheat("merge.addCoins");
   * ```
   */
  const onCheat = (id: string): Promise<void> => runCheat(octx, id);
  const card = h(OverlayCard, { ...viewOf(octx.state, octx.config, Date.now()), onCheat });
  const hasSheet = "adoptedStyleSheets" in root && root.adoptedStyleSheets.length > 0;
  render(hasSheet ? card : h(Fragment, {}, h("style", {}, overlayCss), card), root);
}

/**
 * Whether a cheat result still shows at `now` (✓ for OK_MS, ! for ERROR_MS).
 *
 * @param result - The last result of a cheat.
 * @param now - Epoch milliseconds.
 * @returns True while the mark shows.
 * @example
 * ```ts
 * isShowing({ ok: true, message: undefined, at: 0 }, 1199); // true
 * ```
 */
function isShowing(result: CheatResult, now: number): boolean {
  return now - result.at < (result.ok ? OK_MS : ERROR_MS);
}

/**
 * One cheat button as painted at `now`.
 *
 * @param state - Overlay state.
 * @param id - The cheat id.
 * @param title - The cheat title.
 * @param now - Epoch milliseconds.
 * @returns The button view.
 * @example
 * ```ts
 * cheatView(state, "merge.addCoins", "Add coins", Date.now()).state; // "idle"
 * ```
 */
function cheatView(state: OverlayState, id: string, title: string, now: number): CheatView {
  if (state.busy.has(id)) return { id, title, state: "busy", message: undefined };

  const result = state.results.get(id);
  if (result === undefined || !isShowing(result, now)) {
    return { id, title, state: "idle", message: undefined };
  }
  return result.ok
    ? { id, title, state: "ok", message: undefined }
    : { id, title, state: "error", message: result.message };
}

/**
 * The status line text: the newest result that still shows, or "".
 *
 * @param state - Overlay state.
 * @param now - Epoch milliseconds.
 * @returns "Cheat sent: <title>", "Cheat failed: <message>" or "".
 * @example
 * ```ts
 * announceOf(state, Date.now()); // "Cheat sent: Add 100 coins"
 * ```
 */
function announceOf(state: OverlayState, now: number): string {
  let newest: [string, CheatResult] | undefined;
  for (const entry of state.results) {
    if (isShowing(entry[1], now) && (newest === undefined || entry[1].at >= newest[1].at)) {
      newest = entry;
    }
  }
  if (newest === undefined) return "";

  const [id, result] = newest;
  if (!result.ok) return `Cheat failed: ${result.message ?? id}`;
  const title = state.cheats.find(cheat => cheat.id === id)?.title ?? id;
  return `Cheat sent: ${title}`;
}

/**
 * Everything the card paints, from state and config at `now` (pure).
 *
 * @param state - Overlay state.
 * @param config - Overlay config (the corner).
 * @param now - Epoch milliseconds; results older than OK_MS / ERROR_MS are idle again.
 * @returns The view.
 * @example
 * ```ts
 * viewOf(state, config, Date.now()).chips[0]?.text; // "fps 60"
 * ```
 */
export function viewOf(state: OverlayState, config: Readonly<Config>, now: number): OverlayView {
  const status: LinkStatus = state.link ?? { kind: "connecting" };
  return {
    corner: config.corner,
    link: state.hasBridge ? { kind: status.kind, label: linkLabel(status) } : undefined,
    chips: renderChips(state.render, state.renderUnavailable),
    cheats: state.cheats.map(cheat => cheatView(state, cheat.id, cheat.title, now)),
    announce: announceOf(state, now)
  };
}

/**
 * The label of the link dot (also its aria-label and title).
 *
 * @param status - The last bridge status.
 * @returns The label.
 * @example
 * ```ts
 * linkLabel({ kind: "live", frame: 12 }); // "Editor live · frame 12"
 * ```
 */
export function linkLabel(status: LinkStatus): string {
  switch (status.kind) {
    case "connecting": {
      return "Connecting to the editor";
    }
    case "live": {
      return `Editor live · frame ${status.frame}`;
    }
    case "paused": {
      return `Game paused · frame ${status.frame}`;
    }
    case "silent": {
      return `Editor silent · last frame ${status.lastFrame}`;
    }
    case "lost": {
      return `Editor link lost · retry in ${Math.ceil(status.retryInMs / 1000)} s`;
    }
    default: {
      return "No editor session";
    }
  }
}

/**
 * The chip texts of the render numbers (pure): fps, frame time and texture memory; one waiting
 * chip before the first numbers; one dash chip when game.render is unavailable.
 *
 * @param numbers - The latest numbers, if any.
 * @param unavailable - Whether game.render is missing or its read threw.
 * @returns The chips, in order.
 * @example
 * ```ts
 * renderChips({ fps: 60, frameMs: 4.1, textureMb: 31.1 }, false).map(chip => chip.text); // ["fps 60", "4.1 ms", "textures 31.1 MB"]
 * ```
 */
export function renderChips(
  numbers: RenderNumbers | undefined,
  unavailable: boolean
): readonly RenderChip[] {
  if (unavailable) return [{ key: "render", text: "render —", title: UNAVAILABLE_TITLE }];
  if (numbers === undefined) return [{ key: "render", text: "render …", title: undefined }];
  return [
    { key: "fps", text: `fps ${Math.round(numbers.fps)}`, title: undefined },
    { key: "frame", text: `${numbers.frameMs.toFixed(1)} ms`, title: undefined },
    { key: "textures", text: `textures ${numbers.textureMb.toFixed(1)} MB`, title: undefined }
  ];
}

/**
 * Reads the three numbers of a game.render value: an object with numeric `fps`, `frameMs` and
 * `textureMb`, else undefined.
 *
 * @param value - A game.render wire value.
 * @returns The numbers, or undefined.
 * @example
 * ```ts
 * toRenderNumbers({ fps: 60, frameMs: 3.4, textures: 12, textureMb: 41.25 }); // { fps: 60, frameMs: 3.4, textureMb: 41.25 }
 * ```
 */
export function toRenderNumbers(value: Json): RenderNumbers | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;

  const { fps, frameMs, textureMb } = value;
  if (typeof fps !== "number" || typeof frameMs !== "number" || typeof textureMb !== "number") {
    return undefined;
  }
  return { fps, frameMs, textureMb };
}
