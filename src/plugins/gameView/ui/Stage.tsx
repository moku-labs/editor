/**
 * @file gameView plugin — the dotted stage (A2): the bezel around the screen slot sized W·k × H·k
 * with the preset's screen radius at the same scale (`--screen-radius`, round 2 R3), the dock of the one game frame over the slot (`gameFrame().dock`, the iframe never moves, R4,
 * D-14) clipped to the stage less the open Element panel drawer, the badges (F12) and the picker
 * hint pill. Everything drawn over the game screen lives in gameView's overlay root
 * (ensureOverlayRoot), not here.
 */
import type { RefObject, VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { linkPlugin } from "../../link";
import { rectSourceOf } from "../../panels/shared/scene";
import type { LinkStatus, Manifest } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { resolveDevice } from "../../workspace/devices";
import { fitScale, slotSize } from "../stage/geometry";
import type { GameViewCtx, GameViewState } from "../types";
import { ensureOverlayRoot } from "./OverlayRoot";
import { elapsedText, linkBadge, type StageBadge } from "./text";
import { useDrawerCover } from "./useDrawerCover";
import { RECORD_TICK_MS, SILENT_TICK_MS, useGameView, useTicker } from "./useGameView";

/**
 * Props of `Stage`.
 */
export type StageProps = { readonly ctx: GameViewCtx; readonly status: LinkStatus };

/**
 * A measured size in px.
 */
type Size = { readonly w: number; readonly h: number };

/**
 * Measures an element once.
 *
 * @param element - The element.
 * @param onSize - Receives its size.
 */
function measureInto(element: HTMLElement, onSize: (size: Size) => void): void {
  const rect = element.getBoundingClientRect();
  onSize({ w: rect.width, h: rect.height });
}

/**
 * Measures an element now and on every resize (where ResizeObserver exists).
 *
 * @param element - The stage viewport.
 * @param onSize - Receives the size.
 * @returns Stops observing.
 */
function observeSize(element: HTMLElement | null, onSize: (size: Size) => void): () => void {
  if (element === null) return () => {};
  measureInto(element, onSize);
  if (globalThis.ResizeObserver === undefined) return () => {};
  const observer = new ResizeObserver(() => measureInto(element, onSize));
  observer.observe(element);
  return () => observer.disconnect();
}

/**
 * Docks the game frame over the slot (fit or actual size, clipped by the stage clip); the
 * release goes into the disposers so onStop releases it too.
 *
 * @param ctx - Domain context of gameView.
 * @param slot - The screen slot.
 * @param clip - The stage clip: the stage less the open drawer.
 * @param zoom - The stage zoom.
 * @returns Releases the dock (and drops it from the disposers).
 */
function dockSlot(
  ctx: GameViewCtx,
  slot: HTMLElement | null,
  clip: HTMLElement | null,
  zoom: GameViewState["zoom"]
): () => void {
  if (slot === null || clip === null) return () => {};
  const { disposers } = ctx.state;
  const fit = zoom === "fit" ? "fit" : "actual";
  const release = ctx.require(workspacePlugin).gameFrame().dock(slot, { fit, clip });
  disposers.push(release);
  ensureOverlayRoot(ctx);
  return () => {
    const index = disposers.indexOf(release);
    if (index !== -1) disposers.splice(index, 1);
    release();
  };
}

/**
 * Keeps the game frame docked over the slot: docked at mount, again on a zoom change and on a
 * change of the drawer cover (so the frame clips in the same pass, not a resize observation
 * later), released on unmount. The newer dock replaces the older one before the older one is
 * released, so the frame never hides in between.
 *
 * @param ctx - Domain context of gameView.
 * @param parts - The screen slot and the stage clip.
 * @param parts.slot - The screen slot.
 * @param parts.clip - The stage clip.
 * @param zoom - The stage zoom.
 * @param cover - The px the open drawer covers.
 */
function useStageDock(
  ctx: GameViewCtx,
  parts: { readonly slot: RefObject<HTMLElement>; readonly clip: RefObject<HTMLElement> },
  zoom: GameViewState["zoom"],
  cover: number
): void {
  const release = useRef<() => void>(() => {});

  useLayoutEffect(() => {
    const previous = release.current;
    release.current = dockSlot(ctx, parts.slot.current, parts.clip.current, zoom);
    previous();
  }, [zoom, cover]);
  useLayoutEffect(() => () => release.current(), []);
}

/**
 * The badges over the stage: the link badge, a reload in flight, the recording.
 *
 * @param status - The link status.
 * @param state - gameView state.
 * @returns The badges in display order.
 */
function stageBadges(status: LinkStatus, state: GameViewState): readonly StageBadge[] {
  const badges: StageBadge[] = [];
  const link = linkBadge(status, Date.now());
  if (link !== undefined) badges.push(link);
  if (state.reloading) {
    badges.push({ key: "reload", text: "Reloading game", tone: "info", spinner: true });
  }
  const { recording } = state.series;
  if (recording !== undefined) {
    const elapsed = elapsedText(performance.now() - recording.startedAt);
    badges.push({ key: "rec", text: `● REC ${elapsed} s`, tone: "rec", spinner: false });
  }
  return badges;
}

/**
 * The hint pill while picking. A game whose manifest lists neither `game.locate` nor `game.rect`
 * reports no element rects, so the picker cannot place anything.
 *
 * @param state - gameView state.
 * @param manifest - The game's manifest, undefined before a session.
 * @returns The hint, undefined while not picking.
 */
function pickerHint(state: GameViewState, manifest: Manifest | undefined): string | undefined {
  if (!state.picker.on) return undefined;
  if (manifest !== undefined && rectSourceOf(manifest) === undefined) {
    return "This game reports no element rects";
  }
  if (state.calibrationRead && state.calibration === undefined) {
    return "Picker needs one keyed element";
  }
  return "Hover the game, click to select · Esc";
}

/**
 * The stage.
 *
 * @param props - The gameView domain context and the link status.
 * @returns The stage.
 */
export function Stage(props: StageProps): VNode {
  const { ctx, status } = props;
  const { state } = ctx;
  const zoom = useGameView(state, () => state.zoom);
  const root = useRef<HTMLDivElement>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Size>({ w: 0, h: 0 });
  const cover = useDrawerCover(root);
  useLayoutEffect(() => observeSize(viewport.current, setMeasured), []);
  useStageDock(ctx, { slot, clip }, zoom, cover);
  const silent = status.kind === "silent" || status.kind === "lost";
  useTicker(
    silent || state.series.recording !== undefined,
    silent ? SILENT_TICK_MS : RECORD_TICK_MS
  );

  const choice = ctx.require(workspacePlugin).device();
  const size = resolveDevice(choice.preset, choice.orientation);
  const desktop = choice.preset.kind === "desktop";
  const fitted = measured.w > 0 ? fitScale(measured, size, desktop) : 1;
  const scale = zoom === "fit" ? fitted : 1;
  const slotPx = slotSize(size, scale);
  const hint = pickerHint(state, ctx.require(linkPlugin).manifest());

  return (
    <div
      data-game="stage"
      ref={root}
      data-zoom={zoom}
      data-stale={silent ? status.kind : undefined}
    >
      <div data-part="viewport" ref={viewport}>
        <div
          data-part="bezel"
          data-kind={choice.preset.kind}
          data-orientation={choice.orientation}
          style={{ "--screen-radius": `${choice.preset.radius * scale}px` }}
        >
          <div
            data-part="slot"
            ref={slot}
            style={{ width: `${slotPx.w}px`, height: `${slotPx.h}px` }}
          />
        </div>
      </div>
      <div data-part="clip" ref={clip} aria-hidden="true" style={{ right: `${cover}px` }} />
      <div data-part="badges">
        {stageBadges(status, state).map(badge => (
          <span key={badge.key} data-part="badge" data-tone={badge.tone}>
            {badge.spinner && <span data-spinner="" aria-hidden="true" />}
            {badge.text}
          </span>
        ))}
      </div>
      {hint !== undefined && (
        <div data-part="hint" role="status">
          {hint}
        </div>
      )}
    </div>
  );
}
