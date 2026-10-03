/**
 * @file gameView plugin — the dotted stage (A2): the bezel around the screen slot sized W·k × H·k,
 * the dock of the one game frame over the slot (`gameFrame().dock`, the iframe never moves, R4,
 * D-14), the badges (F12) and the picker hint pill. Everything drawn over the game screen lives
 * in gameView's overlay root (ensureOverlayRoot), not here.
 */
import type { VNode } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import type { LinkStatus } from "../../registry/protocol";
import { workspacePlugin } from "../../workspace";
import { resolveDevice } from "../../workspace/devices";
import { fitScale, slotSize } from "../stage/geometry";
import type { GameViewCtx, GameViewState } from "../types";
import { ensureOverlayRoot } from "./OverlayRoot";
import { elapsedText, linkBadge, type StageBadge } from "./text";
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
 * Docks the game frame over the slot (fit or actual size, clipped by the stage viewport); the
 * release goes into the disposers so onStop releases it too.
 *
 * @param ctx - Domain context of gameView.
 * @param slot - The screen slot.
 * @param clip - The stage viewport.
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
 * The hint pill while picking.
 *
 * @param state - gameView state.
 * @returns The hint, undefined while not picking.
 */
function pickerHint(state: GameViewState): string | undefined {
  if (!state.picker.on) return undefined;
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
  const viewport = useRef<HTMLDivElement>(null);
  const slot = useRef<HTMLDivElement>(null);
  const [measured, setMeasured] = useState<Size>({ w: 0, h: 0 });
  useLayoutEffect(() => observeSize(viewport.current, setMeasured), []);
  useLayoutEffect(() => dockSlot(ctx, slot.current, viewport.current, zoom), [zoom]);
  const silent = status.kind === "silent" || status.kind === "lost";
  useTicker(
    silent || state.series.recording !== undefined,
    silent ? SILENT_TICK_MS : RECORD_TICK_MS
  );

  const choice = ctx.require(workspacePlugin).device();
  const size = resolveDevice(choice.preset, choice.orientation);
  const desktop = choice.preset.kind === "desktop";
  const fitted = measured.w > 0 ? fitScale(measured, size, desktop) : 1;
  const slotPx = slotSize(size, zoom === "fit" ? fitted : 1);
  const hint = pickerHint(state);

  return (
    <div data-game="stage" data-zoom={zoom} data-stale={silent ? status.kind : undefined}>
      <div data-part="viewport" ref={viewport}>
        <div data-part="bezel" data-kind={choice.preset.kind} data-orientation={choice.orientation}>
          <div
            data-part="slot"
            ref={slot}
            style={{ width: `${slotPx.w}px`, height: `${slotPx.h}px` }}
          />
        </div>
      </div>
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
